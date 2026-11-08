import type { TaskInput, TaskPatch } from "@/lib/tasks/schema";
import type { Task, TaskTree, TaskCounts } from "@/lib/tasks/types";
import type { Checkpoint } from "@/lib/projects/checkpoints";
import type { RuntimeSnapshot, ProcessKind } from "@/lib/projects/runtime-types";
import type { workspaceGitState } from "@/lib/projects/workspace-git";
import type { PromptImage } from "@/lib/prompts/schema";
import type { RevisionComment, RevisionStat } from "@/lib/revisions/build-payload";
import type { ModelOption, SessionMeta } from "@/lib/agent/types";
import type { Artifact, DocComment } from "@/lib/documents/types";
import type { RoutineInput, RoutinePatch } from "@/lib/routines/schema";
import type { Routine, RoutineRun, RoutineSummary } from "@/lib/routines/types";
import type { VaultItem } from "@/lib/vault/types";
import type { Note, NoteFlags, NoteFolder, NoteMeta, NoteScopeKind } from "@/lib/notes/types";
import type {
  Project,
  ProjectSummary,
  Workspace,
  WorkspaceChanges,
  WorkspacePrStatus,
  WorkspaceSummary,
} from "@/lib/projects/types";

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

const post = <T>(url: string, json: unknown) => call<T>(url, { method: "POST", json });

export const api = {
  // Vault
  listVault: (projectId: string) => call<{ items: VaultItem[]; dir: string }>(`/api/projects/${projectId}/vault`),
  listAllVault: () => call<{ items: (VaultItem & { projectName: string })[] }>("/api/vault"),
  /** One request per call; send files one at a time so each stays under the proxy body limit. */
  uploadVault: (projectId: string, input: { file?: File; text?: string; title?: string }) => {
    const form = new FormData();
    if (input.file) form.append("file", input.file);
    if (input.text) form.append("text", input.text);
    if (input.title) form.append("title", input.title);
    return call<{ items: VaultItem[] }>(`/api/projects/${projectId}/vault`, { method: "POST", body: form });
  },
  patchVaultItem: (projectId: string, id: string, patch: { title?: string; reextract?: true }) =>
    call<{ item: VaultItem }>(`/api/projects/${projectId}/vault/${id}`, { method: "PATCH", json: patch }),
  deleteVaultItem: (projectId: string, id: string) => call(`/api/projects/${projectId}/vault/${id}`, { method: "DELETE" }),
  promoteVaultIdea: (projectId: string, id: string, ideaId: string, to: "note" | "task") =>
    post<{ item: VaultItem; noteId?: string; taskId?: string }>(`/api/projects/${projectId}/vault/${id}/promote`, { ideaId, to }),
  // Projects
  listProjects: () => call<{ projects: ProjectSummary[] }>("/api/projects"),
  addProject: (
    body:
      | { source: "folder"; path: string }
      | { source: "github"; url: string; parent: string }
      | { source: "new"; parent: string; name: string; git?: boolean },
  ) => post<{ project: Project; workspace: Workspace }>("/api/projects", body),
  pickFolder: (body: { prompt?: string; defaultPath?: string } = {}) =>
    post<{ path: string | null }>("/api/fs/pick-folder", body),
  renameProject: (id: string, name: string) => call(`/api/projects/${id}`, { method: "PATCH", json: { name } }),
  deleteProject: (id: string) => call(`/api/projects/${id}`, { method: "DELETE" }),
  // Workspaces
  listWorkspaces: (projectId: string) =>
    call<{ workspaces: WorkspaceSummary[] }>(`/api/workspaces?projectId=${encodeURIComponent(projectId)}`),
  createWorkspace: (body: { projectId: string; name?: string; worktree?: boolean; branch?: string; baseRef?: string }) =>
    post<{ workspace: Workspace }>("/api/workspaces", body),
  updateWorkspace: (id: string, body: { name?: string; status?: "active" | "archived" }) =>
    call(`/api/workspaces/${id}`, { method: "PATCH", json: body }),
  deleteWorkspace: (id: string, opts: { worktree?: boolean; memory?: boolean } = {}) =>
    call(`/api/workspaces/${id}?worktree=${opts.worktree ? 1 : 0}&memory=${opts.memory ? 1 : 0}`, { method: "DELETE" }),
  workspaceRuntime: (id: string) => call<RuntimeSnapshot>(`/api/workspaces/${id}/runtime`),
  workspaceProcess: (id: string, body:
    | { action: "setup" | "run" | "shell" }
    | { action: "stop"; kind: ProcessKind }
    | { action: "input"; processId: string; data?: string; cols?: number; rows?: number }
  ) => post(`/api/workspaces/${id}/runtime`, body),
  workspaceGit: (id: string) => call<{ git: Awaited<ReturnType<typeof workspaceGitState>> }>(`/api/workspaces/${id}/git`),
  workspaceGitAction: (id: string, action: string, deleteAfter = false) =>
    post<{ ok: boolean; deleted: boolean }>(`/api/workspaces/${id}/git`, { action, deleteAfter }),
  checkpoints: (id: string) => call<{ checkpoints: Checkpoint[] }>(`/api/workspaces/${id}/checkpoints`),
  rewind: (id: string, checkpointId: string) => post<{ recovery: Checkpoint }>(`/api/workspaces/${id}/checkpoints`, { checkpointId }),
  workspaceChanges: (id: string) => call<{ changes: WorkspaceChanges | null }>(`/api/workspaces/${id}/changes`),
  workspaceFileDiff: (id: string, path: string) =>
    call<{ diff: string }>(`/api/workspaces/${id}/changes?path=${encodeURIComponent(path)}`),
  workspacePr: (id: string) => call<{ status: WorkspacePrStatus }>(`/api/workspaces/${id}/pr`),
  workspaceArtifacts: (id: string) => call<{ artifacts: Artifact[] }>(`/api/workspaces/${id}/artifacts`),
  // Memory (project or workspace scope)
  getMemory: (scope: "projects" | "workspaces", id: string) =>
    call<{ path: string; content: string }>(`/api/${scope}/${id}/memory`),
  putMemory: (scope: "projects" | "workspaces", id: string, content: string) =>
    call(`/api/${scope}/${id}/memory`, { method: "PUT", json: { content } }),
  // Notes (project or workspace scope). Memory is the note with id "memory".
  listNotes: (scope: NoteScopeKind, id: string) => call<{ notes: NoteMeta[]; dir: string }>(`/api/${scope}/${id}/notes`),
  noteCounts: () => call<{ counts: Record<string, number> }>("/api/notes/counts"),
  listAllNotes: () => call<{ projects: NoteFolder[] }>("/api/notes"),
  getNote: (scope: NoteScopeKind, id: string, noteId: string) =>
    call<{ note: Note }>(`/api/${scope}/${id}/notes/${noteId}`),
  createNote: (scope: NoteScopeKind, id: string, body: { title?: string; markdown?: string } & Partial<NoteFlags> = {}) =>
    post<{ note: Note }>(`/api/${scope}/${id}/notes`, body),
  patchNote: (scope: NoteScopeKind, id: string, noteId: string, body: { title?: string; markdown?: string; task?: { line: number; text: string; done: boolean } } & Partial<NoteFlags>) =>
    call<{ note: Note }>(`/api/${scope}/${id}/notes/${noteId}`, { method: "PATCH", json: body }),
  deleteNote: (scope: NoteScopeKind, id: string, noteId: string) =>
    call(`/api/${scope}/${id}/notes/${noteId}`, { method: "DELETE" }),
  // Tasks
  listTasks: (opts: { projectId?: string; workspaceId?: string; status?: "open" } = {}) =>
    call<{ tasks: Task[] }>(`/api/tasks?${new URLSearchParams(opts)}`),
  taskTree: (projectId: string) => call<{ tree: TaskTree }>(`/api/tasks/tree?projectId=${encodeURIComponent(projectId)}`),
  taskCounts: () => call<{ counts: TaskCounts }>("/api/tasks/counts"),
  createTask: (body: TaskInput) => post<{ task: Task }>("/api/tasks", body),
  patchTask: (id: string, body: TaskPatch) => call<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", json: body }),
  deleteTask: (id: string) => call(`/api/tasks/${id}`, { method: "DELETE" }),
  sendTask: (id: string, body: { sessionId?: string; workspaceId?: string }) => post<{ sessionId: string; workspaceId: string }>(`/api/tasks/${id}/send`, body),
  taskImportCount: (workspaceId: string) => call<{ count: number }>(`/api/tasks/import-notes?workspaceId=${encodeURIComponent(workspaceId)}`),
  importNoteTasks: (workspaceId: string) => post<{ imported: number }>("/api/tasks/import-notes", { workspaceId }),
  // Routines
  listRoutines: (projectId?: string) =>
    call<{ routines: RoutineSummary[] }>(`/api/routines${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  createRoutine: (body: RoutineInput) => post<{ routine: Routine }>("/api/routines", body),
  getRoutine: (id: string) => call<{ routine: Routine; runs: RoutineRun[] }>(`/api/routines/${id}`),
  updateRoutine: (id: string, body: RoutinePatch) => call<{ routine: Routine }>(`/api/routines/${id}`, { method: "PATCH", json: body }),
  deleteRoutine: (id: string) => call(`/api/routines/${id}`, { method: "DELETE" }),
  runRoutine: (id: string) => post<{ run: RoutineRun }>(`/api/routines/${id}/run`, {}),
  listRoutineRuns: (id: string, limit = 20) => call<{ runs: RoutineRun[] }>(`/api/routines/${id}/runs?limit=${limit}`),
  cancelRoutineRun: (id: string, runId: string) => call(`/api/routines/${id}/runs/${runId}`, { method: "DELETE" }),
  listModels: () => call<{ models: ModelOption[]; codexError: string | null }>("/api/models"),
  // Sessions
  createSession: (body: {
    workspaceId?: string;
    cwd?: string;
    model?: string;
    permissionMode?: string;
    prompt?: string;
    images?: PromptImage[];
    resumeSdkSessionId?: string;
    title?: string;
  }) => post<{ id: string; workspaceId: string }>("/api/sessions", body),
  getSession: (id: string) => call<{ session: SessionMeta }>(`/api/sessions/${id}`),
  deleteSession: (id: string) => call(`/api/sessions/${id}`, { method: "DELETE" }),
  listSessions: (opts: { workspaceId?: string; projectId?: string } = {}) =>
    call<{ sessions: SessionMeta[] }>(
      `/api/sessions?${new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][])}`,
    ),
  resume: (id: string) => post<{ session: SessionMeta; seq: number }>(`/api/sessions/${id}/resume`, {}),
  send: (id: string, content: string, images: PromptImage[] = []) => post<{ messageId: string }>(`/api/sessions/${id}/input`, { content, images }),
  promptContext: (id: string) =>
    call<{ files: string[]; commands: string[]; notes: { title: string; path: string }[] }>(`/api/workspaces/${id}/prompt-context`),
  permission: (
    id: string,
    body: { requestId: string; decision: "allow" | "allow_always" | "deny"; message?: string },
  ) => post(`/api/sessions/${id}/permission`, body),
  answer: (id: string, body: { requestId: string; answers: Record<string, string> | null }) =>
    post(`/api/sessions/${id}/answer`, body),
  approvePlan: (
    id: string,
    body: { requestId: string; documentId: string; editedMarkdown: string; nextMode?: string },
  ) => post(`/api/sessions/${id}/plan`, { ...body, decision: "approve" }),
  requestPlanChanges: (
    id: string,
    body: {
      requestId: string;
      documentId: string;
      version: number;
      baselineMarkdown: string;
      editedMarkdown: string;
      comments: RevisionComment[];
    },
  ) => post<{ payload: string; stat: RevisionStat }>(`/api/sessions/${id}/plan`, { ...body, decision: "changes" }),
  control: (
    id: string,
    body:
      | { action: "interrupt" | "close" }
      | { action: "setModel"; value: string }
      | { action: "setPermissionMode"; value: string },
  ) => post(`/api/sessions/${id}/control`, body),
  patchDocument: (id: string, body: { currentMarkdown?: string; baselineMarkdown?: string; contentJson?: unknown }) =>
    call(`/api/documents/${id}`, { method: "PATCH", json: body }),
  syncComments: (id: string, comments: DocComment[]) =>
    call(`/api/documents/${id}/comments`, { method: "PUT", json: { comments } }),
  sendRevision: (
    documentId: string,
    body: {
      sessionId: string;
      version: number;
      baselineMarkdown: string;
      editedMarkdown: string;
      comments: RevisionComment[];
    },
  ) => post<{ payload: string; stat: RevisionStat }>(`/api/documents/${documentId}/revisions`, body),
};
