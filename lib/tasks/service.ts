import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { getWorkspace, listWorkspaces } from "@/lib/supabase/repo/workspaces";
import { getSessionRow } from "@/lib/supabase/repo/sessions";
import { getTask, insertTask, listTasks, updateTask } from "@/lib/supabase/repo/tasks";
import { dirsForScope, repoDirsFor, repoNoteDirs } from "@/lib/notes/resolve";
import { listNotes, tasksOf, readNote, writeNote } from "@/lib/notes/store";
import { repoTaskLink, parseRepoTaskLink } from "@/lib/notes/task-link";
import { extractTasks } from "@/lib/notes/frontmatter";
import { TaskInputSchema, TaskPatchSchema, type TaskInput, type TaskPatch } from "./schema";
import type { NoteImportScope, Task, TaskTree } from "./types";

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
  if (patch.status !== undefined && patch.status !== task.status) {
    try { await writeBackRepoTask(result); }
    catch (err) { console.error("[thunk] task board write-back", err); }
  }
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

export async function noteImportCandidates(scope: NoteImportScope) {
  let projectId: string;
  let workspaceId: string | null = null;
  let workspaceNotes: Awaited<ReturnType<typeof listNotes>> = [];
  if ("workspaceId" in scope) {
    workspaceId = scope.workspaceId;
    const workspace = await getWorkspace(taskId(workspaceId));
    if (!workspace) throw new HttpError(404, "Workspace not found");
    projectId = workspace.projectId;
    workspaceNotes = await listNotes(await dirsForScope({ kind: "workspaces", id: workspaceId }));
  } else projectId = taskId(scope.projectId);
  const project = await getProject(projectId);
  if (!project) throw new HttpError(404, "Project not found");
  const repoNotes = (await Promise.all((await repoDirsFor(project)).map((d) => listNotes(d)))).flat();
  const projectNotes = await listNotes(await dirsForScope({ kind: "projects", id: projectId }));
  const items = [
    ...tasksOf(workspaceNotes).map((item) => ({ ...item, workspaceId })),
    ...tasksOf(projectNotes).map((item) => ({ ...item, workspaceId: null })),
    ...repoNotes.flatMap((note) => extractTasks(note.markdown).map((item) => ({ ...item, noteId: repoTaskLink(note.scope.id, note.id), workspaceId: null, folder: project.repoFolders.find((f) => f.id === note.scope.id)!.path }))),
  ];
  const occurrences = new Map<string, number>();
  const candidates = items.map((item) => {
    const key = JSON.stringify([item.workspaceId ?? projectId, item.noteId, item.text]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    // Content + occurrence keeps IDs stable when unrelated note lines move, including duplicate checklists.
    const id = importedTaskId(key, occurrence);
    return { id, done: item.done, folder: "folder" in item ? item.folder as string : null, projectId, workspaceId: item.workspaceId, noteId: item.noteId, title: item.text.trim().slice(0, 200), body: item.text.length > 200 ? item.text : null };
  });
  const pending = [];
  for (const candidate of candidates) {
    if (candidate.done || await getTask(candidate.id)) continue;
    parse(TaskInputSchema, { projectId: candidate.projectId, workspaceId: candidate.workspaceId, noteId: candidate.noteId, title: candidate.title, body: candidate.body });
    pending.push(candidate);
  }
  return pending;
}
export async function importNoteTasks(scope: NoteImportScope): Promise<number> {
  let imported = 0;
  for (const candidate of await noteImportCandidates(scope)) {
    try { await insertTask(candidate); imported++; }
    catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  return imported;
}

// shortcut: identical items use occurrence order; add persistent item IDs if duplicate deletion must preserve identity.
function importedTaskId(key: string, occurrence: number) {
  const hash = createHash("sha256").update(JSON.stringify([key, occurrence])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function writeBackRepoTask(task: Task) {
  const link = parseRepoTaskLink(task.noteId);
  if (!link) return;
  const project = await getProject(task.projectId);
  const folder = project?.repoFolders.find((f) => f.id === link.scope.id);
  if (!project || !folder) throw new Error("Linked notebook no longer exists");
  const dirs = await repoNoteDirs(project, folder);
  const note = await readNote(dirs, link.id);
  if (!note) throw new Error("Linked board no longer exists");
  const occurrences = new Map<string, number>();
  const items = extractTasks(note.markdown);
  let item = items.find((item) => {
    const key = JSON.stringify([project.id, task.noteId, item.text]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return importedTaskId(key, occurrence) === task.id;
  });
  if (!item) {
    const matches = items.filter((i) => i.text === (task.body ?? task.title));
    if (matches.length === 1) item = matches[0];
  }
  if (!item) throw new Error("Task is not in board or its text is ambiguous");
  await writeNote(dirs, link.id, { expectedUpdatedAt: note.updatedAt, task: { line: item.line, text: item.text, done: task.status === "done" || task.status === "cancelled" } });
}
