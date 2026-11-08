import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { getWorkspace, listWorkspaces } from "@/lib/supabase/repo/workspaces";
import { getSessionRow } from "@/lib/supabase/repo/sessions";
import { getTask, insertTask, listTasks, updateTask } from "@/lib/supabase/repo/tasks";
import { dirsForScope } from "@/lib/notes/resolve";
import { listNotes, tasksOf } from "@/lib/notes/store";
import { TaskInputSchema, TaskPatchSchema, type TaskInput, type TaskPatch } from "./schema";
import type { Task, TaskTree } from "./types";

export function taskId(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new HttpError(400, "Invalid id");
  return id;
}
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}
async function validateScope(projectId: string, workspaceId: string | null, sessionIds: (string | null | undefined)[]) {
  if (!await getProject(projectId)) throw new HttpError(404, "Project not found");
  if (workspaceId) {
    const workspace = await getWorkspace(workspaceId);
    if (!workspace || workspace.projectId !== projectId) throw new HttpError(400, "Workspace does not belong to project");
  }
  for (const id of sessionIds) {
    if (!id) continue;
    taskId(id);
    const { getSession } = await import("@/lib/agent");
    const session = getSession(id)?.meta ?? await getSessionRow(id);
    const workspace = session && await getWorkspace(session.workspaceId);
    if (!session || !workspace || workspace.projectId !== projectId || (workspaceId && workspace.id !== workspaceId))
      throw new HttpError(400, "Session does not belong to task scope");
  }
}
export async function createTask(input: TaskInput, options: { createdBy?: Task["createdBy"]; createdInSessionId?: string | null } = {}): Promise<Task> {
  const body = parse(TaskInputSchema, input);
  const provenance = parse(z.object({ createdBy: z.enum(["user", "agent", "routine"]).optional(), createdInSessionId: z.uuid().nullable().optional() }).strict(), options);
  await validateScope(body.projectId, body.workspaceId ?? null, [body.sessionId, provenance.createdInSessionId]);
  return insertTask({ ...body, ...provenance });
}
export async function patchTask(id: string, input: TaskPatch): Promise<Task> {
  const patch = parse(TaskPatchSchema, input);
  const task = await getTask(taskId(id));
  if (!task) throw new HttpError(404, "Task not found");
  const workspaceId = patch.workspaceId === undefined ? task.workspaceId : patch.workspaceId;
  const sessionId = patch.sessionId === undefined ? task.sessionId : patch.sessionId;
  await validateScope(task.projectId, workspaceId, [sessionId]);
  const { after, ...changes } = patch;
  if (after) {
    const peers = (await listTasks({ projectId: task.projectId, workspaceId })).filter((t) => t.id !== id);
    const index = peers.findIndex((t) => t.id === after);
    if (index < 0) throw new HttpError(400, "after must identify another task in the same scope");
    changes.position = peers[index + 1] ? (peers[index].position + peers[index + 1].position) / 2 : peers[index].position + 1;
  } else if (workspaceId !== task.workspaceId && changes.position === undefined) {
    const peers = await listTasks({ projectId: task.projectId, workspaceId });
    changes.position = (peers.length ? Math.max(...peers.map((t) => t.position)) : 0) + 1;
  }
  const result = await updateTask(id, changes);
  if (!result) throw new HttpError(404, "Task not found");
  return result;
}
export async function taskTree(projectId: string): Promise<TaskTree> {
  const project = await getProject(taskId(projectId));
  if (!project) throw new HttpError(404, "Project not found");
  const [tasks, workspaces] = await Promise.all([listTasks({ projectId }), listWorkspaces(projectId)]);
  return { project: { id: project.id, name: project.name }, tasks: tasks.filter((t) => !t.workspaceId), workspaces: workspaces.map(({ id, name, slug }) => ({ workspace: { id, name, slug }, tasks: tasks.filter((t) => t.workspaceId === id) })) };
}
export async function tasksForWorkspace(id: string): Promise<{ workspace: Task[]; project: Task[] }> {
  const workspace = await getWorkspace(taskId(id));
  if (!workspace) throw new HttpError(404, "Workspace not found");
  const tasks = await listTasks({ projectId: workspace.projectId });
  return { workspace: tasks.filter((t) => t.workspaceId === id), project: tasks.filter((t) => !t.workspaceId) };
}

export async function noteImportCandidates(workspaceId: string) {
  const workspace = await getWorkspace(taskId(workspaceId));
  if (!workspace) throw new HttpError(404, "Workspace not found");
  const [workspaceNotes, projectNotes] = await Promise.all([
    listNotes(await dirsForScope({ kind: "workspaces", id: workspaceId })),
    listNotes(await dirsForScope({ kind: "projects", id: workspace.projectId })),
  ]);
  const items = [
    ...tasksOf(workspaceNotes).map((item) => ({ ...item, workspaceId })),
    ...tasksOf(projectNotes).map((item) => ({ ...item, workspaceId: null })),
  ];
  const occurrences = new Map<string, number>();
  const candidates = items.map((item) => {
    const key = JSON.stringify([item.workspaceId ?? workspace.projectId, item.noteId, item.text]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    // Content + occurrence keeps IDs stable when unrelated note lines move, including duplicate checklists.
    const hash = createHash("sha256").update(JSON.stringify([key, occurrence])).digest("hex");
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { id, projectId: workspace.projectId, workspaceId: item.workspaceId, noteId: item.noteId, title: item.text.trim().slice(0, 200), body: item.text.length > 200 ? item.text : null };
  });
  const pending = [];
  for (const candidate of candidates) {
    if (await getTask(candidate.id)) continue;
    parse(TaskInputSchema, { projectId: candidate.projectId, workspaceId: candidate.workspaceId, noteId: candidate.noteId, title: candidate.title, body: candidate.body });
    pending.push(candidate);
  }
  return pending;
}
export async function importNoteTasks(workspaceId: string): Promise<number> {
  let imported = 0;
  for (const candidate of await noteImportCandidates(workspaceId)) {
    try { await insertTask(candidate); imported++; }
    catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  return imported;
}
