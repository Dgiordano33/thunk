import "server-only";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Project, Workspace } from "@/lib/projects/types";
import { notesDirsFor } from "./resolve";
import { listNotes } from "./store";
import type { Note } from "./types";
import { contextKey, REASONS, type ContextItemDraft, type PromptPart } from "@/lib/context/types";

/** Cap on injected note text so a big notebook can't crowd out the conversation. */
export const INJECT_LIMIT = 24_000;

export type SessionNotes = { projectDir: string; workspaceDir: string; project: Note[]; workspace: Note[]; repos: { label: string; dir: string; extra: boolean; notes: Note[] }[] };

/** Ensure both notes dirs exist (agents may create files there) and read their notes, memory excluded. */
export async function loadSessionNotes(project: Project, workspace: Workspace): Promise<SessionNotes> {
  const dirs = await notesDirsFor(project, workspace);
  await Promise.all([mkdir(dirs.project.notesDir, { recursive: true }), mkdir(dirs.workspace.notesDir, { recursive: true })]);
  const [p, w] = await Promise.all([
    listNotes(dirs.project, { withMemory: false }).catch(() => []),
    listNotes(dirs.workspace, { withMemory: false }).catch(() => []),
  ]);
  return { projectDir: dirs.project.notesDir, workspaceDir: dirs.workspace.notesDir, project: p.filter((n) => !n.workspaceIds?.includes(workspace.id)), workspace: w, repos: await Promise.all(dirs.repos.map(async (d) => {
    const folder = project.repoFolders.find((f) => f.id === d.scope.id)!;
    return { label: folder.label, dir: d.notesDir, extra: !d.notesDir.startsWith(`${workspace.cwd}${path.sep}`), notes: await listNotes(d) };
  })) };
}

const day = (iso: string) => iso.slice(0, 10);

function indexLine(n: Note) {
  const flags = [n.pinned && "pinned", n.inject && "injected below", n.actionable && "actionable"].filter(Boolean);
  const tasks = n.openTasks ? ` · ${n.openTasks} open task${n.openTasks === 1 ? "" : "s"}` : "";
  return `- ${n.title} (\`${n.path}\`) · updated ${day(n.updatedAt)}${tasks}${flags.length ? ` · ${flags.join(", ")}` : ""}`;
}

// A follow-up could expose structured note writes as an in-process MCP server
// (`createSdkMcpServer`); for now agents edit the files with their normal tools.
export function notesPrompt(all: SessionNotes, { exclude }: { exclude?: Set<string> } = {}): PromptPart {
  const kept = (n: Note) => !exclude?.has(contextKey("note", n.id));
  const notes: SessionNotes = { ...all, project: all.project.filter(kept), workspace: all.workspace.filter(kept), repos: all.repos.map((r) => ({ ...r, notes: r.notes.filter(kept) })) };
  const items: ContextItemDraft[] = [];
  const item = (n: Note, mode: ContextItemDraft["mode"], chars: number, reason?: string) =>
    items.push({ kind: "note", refId: n.id, title: n.title, path: n.path, mode, chars, reason: reason ?? null, source: n.markdown, keepContent: true });
  const lines = [
    "# Thunk notes",
    "Rich document blocks use fenced thunk-block-v1 JSON. Preserve their structure, attributes, IDs, and nested content when editing; keep JSON valid.",
    "Besides memory, notes belong to projects and can optionally link to workspaces. Each note is a markdown file with a small frontmatter block (`title`, `pinned`, `inject`, `actionable`, `tags`, `created`, `updated`). Read and edit them with your file tools:",
    `- Project notes: \`${notes.projectDir}\``,
    `- Linked workspace notes use the same project directory.`,
    "",
    "All new notes belong in Project notes. For effort-specific notes, add the workspace ID to the optional `workspaceIds: [id]` frontmatter list; do not create a separate workspace notebook. Edit notes in place and keep the frontmatter intact. Track follow-up work with tasks_create, tasks_update, and tasks_complete; note checklists are not the task list. When a topic doesn't fit an existing note, create `<random-lowercase-id>.md` with frontmatter (title, `pinned: false`, `inject: false`, `tags: []`). This list was captured when the session started; re-read the files for current contents.",
  ];
  for (const [label, list] of [["Project notes", notes.project], ["Project notes linked to this workspace", notes.workspace]] as const) {
    lines.push("", `## ${label}`, ...(list.length ? list.map(indexLine) : ["- (none yet)"]));
  }

  if (notes.repos.length) {
    lines.push("", "## Repo notebooks", "These files are in the main checkout. When working in a worktree, edit your branch's copy; the Library reflects main after merge.");
    for (const repo of notes.repos) lines.push(`- ${repo.label} (\`${repo.dir}\`, in the repo, main checkout)`, ...repo.notes.map(indexLine));
  }
  const every = [...notes.project, ...notes.workspace, ...notes.repos.flatMap((r) => r.notes)];
  const injected = every.filter((n) => n.inject && n.markdown.trim());
  for (const n of every) if (!injected.includes(n)) item(n, "index", 0, n.inject ? undefined : REASONS.notInjected);
  if (injected.length) {
    lines.push("", "## Injected notes (current contents)");
    let budget = INJECT_LIMIT;
    let cut = 0;
    for (const n of injected) {
      const text = n.markdown.trim();
      if (budget <= 0) {
        cut++;
        item(n, "omitted", 0, REASONS.overLimit(INJECT_LIMIT));
        continue;
      }
      const piece = text.length > budget ? `${text.slice(0, budget)}\n…(truncated)` : text;
      if (text.length > budget) {
        cut++;
        item(n, "truncated", budget, REASONS.overLimit(INJECT_LIMIT));
      } else item(n, "full", text.length);
      budget -= piece.length;
      lines.push("", `### ${n.title} (\`${n.path}\`)`, piece);
    }
    if (cut) lines.push("", `(${cut} injected note${cut === 1 ? " was" : "s were"} truncated or omitted to stay under ${INJECT_LIMIT} characters; read the files for the rest.)`);
  }
  return { text: lines.join("\n"), items };
}
