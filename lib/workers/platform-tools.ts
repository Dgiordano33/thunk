import "server-only";
import { z } from "zod";
import type { LiveSession } from "@/lib/agent";

/**
 * What a chief can make in its project besides tasks and workers: notes, workspaces, sessions and routines.
 * (Canvases come from the canvas tools every project session has: lib/board/tools.ts.) A chief cannot use Edit or Write, so these are how it leaves durable artifacts.
 * Each tool acts only inside the chief's own project. Names are listed in PLATFORM_TOOL_NAMES (./prompt) so they are auto-allowed.
 */

type Define = <S extends z.ZodRawShape>(name: string, description: string, schema: S, run: (input: z.infer<z.ZodObject<S>>) => Promise<unknown>) => { name: string; description: string; schema: S; handler: (input: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> };

const flags = { tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(), pinned: z.boolean().optional(), inject: z.boolean().optional() };

export function platformTools(live: LiveSession, define: Define) {
  const project = live.ctx.project;
  const noteDirs = async () => (await import("@/lib/notes/resolve")).projectNoteDirs(project);
  const workspaceIn = async (id: string) => {
    const { getWorkspace } = await import("@/lib/db/repo/workspaces");
    const workspace = await getWorkspace(id);
    if (!workspace || workspace.projectId !== project.id) throw new Error("No workspace with that id in this project; call workspaces_list");
    if (workspace.status === "archived") throw new Error("Workspace is archived");
    return workspace;
  };
  return [
    define("notes_create", "Create a project note (a plan, brief, decision record or reference) that the person and every agent in this project can read. Markdown body; unchecked - [ ] items can be relayed later. inject puts the whole note in every new session's system prompt, so use it sparingly. Returns the note id and file path.",
      { title: z.string().trim().min(1).max(200), markdown: z.string().max(100_000), workspaceIds: z.array(z.string()).max(20).optional(), ...flags },
      async (input) => {
        for (const id of input.workspaceIds ?? []) await workspaceIn(id);
        const { createNote } = await import("@/lib/notes/store");
        const note = await createNote(await noteDirs(), input);
        return { noteId: note.id, path: note.path, title: note.title };
      }),
    define("notes_update", "Replace a project note's title, body or flags. Read the note first (its path is in the notes index) and send the whole new markdown; omitted fields stay as they are.",
      { noteId: z.string().min(1).max(100), title: z.string().trim().min(1).max(200).optional(), markdown: z.string().max(100_000).optional(), ...flags },
      async ({ noteId, ...patch }) => {
        const { MEMORY_NOTE_ID } = await import("@/lib/notes/types");
        if (noteId.toLowerCase() === MEMORY_NOTE_ID) throw new Error("Project memory is not a note; use chief_log for the plan");
        const { writeNote } = await import("@/lib/notes/store");
        const note = await writeNote(await noteDirs(), noteId, patch);
        if (!note) throw new Error("No project note with that id");
        return { noteId: note.id, path: note.path, title: note.title };
      }),
    define("workspaces_list", "List this project's active workspaces: id, name, branch and whether it is an automatic effort workspace.", {}, async () => {
      const { listWorkspaces } = await import("@/lib/db/repo/workspaces");
      return (await listWorkspaces(project.id)).filter((w) => w.status !== "archived").map((w) => ({ workspaceId: w.id, name: w.name, slug: w.slug, branch: w.branch ?? null, visibility: w.visibility ?? "workspace" }));
    }),
    define("workspaces_create", "Create a workspace the person can see in the sidebar, with a fresh git worktree per repo. Use it when they ask for a place to work, or before sessions_start; delegate already makes a worktree for each worker, so do not create one for a worker. repoIds defaults to every project repo.",
      { name: z.string().trim().min(1).max(60).optional(), repoIds: z.array(z.string()).max(20).optional() },
      async ({ name, repoIds }) => {
        const unknown = (repoIds ?? []).filter((id) => !project.repos.some((r) => r.id === id));
        if (unknown.length) throw new Error(`Unknown repoIds: ${unknown.join(", ")}`);
        const { createWorkspace } = await import("@/lib/projects");
        const workspace = await createWorkspace({ projectId: project.id, visibility: "workspace", ...(name ? { name } : {}), ...(repoIds?.length ? { repoIds } : {}) });
        return { workspaceId: workspace.id, name: workspace.name, branch: workspace.branch ?? null, note: "Setup runs in the background." };
      }),
    define("sessions_start", "Start a session in a workspace the person can see and chat in. It gets a task and reports back to you like any worker, so judge its report as usual. Omit workspaceId to create a new visible workspace for it; pass one to work where the person already is (one active worker per workspace). Use delegate instead for background work that needs no visible workspace.",
      { prompt: z.string().trim().min(1).max(20_000), title: z.string().trim().min(1).max(120).optional(), workspaceId: z.string().optional(), model: z.string().min(1).max(100).optional(), permissionMode: z.enum(["default", "acceptEdits", "plan"]).optional() },
      async ({ prompt, title, workspaceId, model, permissionMode }) => {
        const name = title ?? prompt.split("\n")[0].slice(0, 80);
        if (workspaceId) await workspaceIn(workspaceId);
        else workspaceId = (await (await import("@/lib/projects")).createWorkspace({ projectId: project.id, visibility: "workspace", setup: "await" })).id;
        const { delegate } = await import("./service");
        const started = await delegate(project.id, live.id, { title: name, brief: prompt, workspaceId, ...(model ? { model } : {}), ...(permissionMode ? { permissionMode } : {}) });
        if (!("sessionId" in started)) return { ...started, workspaceId, note: "Queued: it starts when a worker slot frees." };
        const { hrefForSession } = await import("@/lib/routes.server");
        return { ...started, href: await hrefForSession(started.workspaceId, started.sessionId) };
      }),
    define("routines_create", "Create a routine: an agent session that starts on a schedule. Only when the person asked for something recurring. scheduleCron is a five-field cron expression; scheduleTz an IANA zone (default UTC). Each run gets its own workspace unless workspaceId is given. Routines fire only while Thunk is running.",
      { name: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(20_000), scheduleCron: z.string().trim().min(1).max(120), scheduleTz: z.string().max(80).optional(), workspaceId: z.string().optional(), model: z.string().min(1).max(100).optional(), enabled: z.boolean().optional() },
      async ({ name, prompt, scheduleCron, scheduleTz, workspaceId, model, enabled }) => {
        if (workspaceId) await workspaceIn(workspaceId);
        const { RoutineInputSchema } = await import("@/lib/routines/schema");
        const { createRoutine } = await import("@/lib/routines/service");
        const routine = await createRoutine(RoutineInputSchema.parse({ projectId: project.id, name, prompt, model: model ?? live.meta.model, scheduleCron, scheduleTz: scheduleTz ?? null, ...(workspaceId ? { targetKind: "workspace", targetWorkspaceId: workspaceId } : {}), ...(enabled === undefined ? {} : { enabled }) }));
        return { routineId: routine.id, name: routine.name, enabled: routine.enabled };
      }),
  ];
}
