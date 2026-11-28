import type { DirListing } from "@/lib/fs/list-dirs";
import type { Notification, NotificationCounts } from "@/lib/notifications/types";
import type { NotificationContext, ReplyMode } from "@/lib/notifications/context";
import type { TaskInput, TaskPatch } from "@/lib/tasks/schema";
import type { NoteImportScope, Task, TaskTree, TaskCounts } from "@/lib/tasks/types";
import type { Checkpoint } from "@/lib/projects/checkpoints";
import type { CreateProjectBody, RepoResult, RepoSpec } from "@/lib/projects/repo-spec";
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
  FileContent,
  FileEntry,
  FileRoot,
  Project,
  ProjectRepo,
  RepoChanges,
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
/** The bulk notification routes accept at most 500 ids per request; send larger sets in batches and merge the results. */
async function postIdBatches(url: string, ids: string[]) {
  const notifications: Notification[] = [];
  for (let i = 0; i < ids.length; i += 500)
    notifications.push(...(await post<{ notifications: Notification[] }>(url, { ids: ids.slice(i, i + 500) })).notifications);
  return { notifications };
}

export const api = {
  openChief: (projectId: string, body: { fresh?: boolean; noteId?: string } = {}) => post<{ sessionId: string; workspaceId: string; href: string }>(`/api/projects/${projectId}/chief`, body),
  delegateNote: (scope: import("@/lib/notes/types").NoteScope, noteId: string) => post<{ sessionId: string; workspaceId: string; href: string; top?: boolean; open?: number }>("/api/notes/delegate", { scope, noteId }),
  getTriage: () => call<{ triage: import("@/lib/home/triage-types").TriageSettings }>("/api/chief/triage"),
  saveTriage: (body: { enabled: boolean; cron: string; tz?: string | null }) => call<{ triage: import("@/lib/home/triage-types").TriageSettings }>("/api/chief/triage", { method: "PUT", json: body }),
  runTriage: () => post<{ result: string; triage: import("@/lib/home/triage-types").TriageSettings }>("/api/chief/triage", {}),
  getBackups: () => call<import("@/lib/backup/types").BackupStatus>("/api/settings/backup"),
  saveBackups: (body: { enabled: boolean; time: string; tz?: string | null; keep: number; dir?: string | null }) => call<import("@/lib/backup/types").BackupStatus>("/api/settings/backup", { method: "PUT", json: body }),
  backUpNow: () => post<import("@/lib/backup/types").BackupStatus & { backup: { name: string; size: number } }>("/api/settings/backup", {}),
  listNotifications: (query = "status=all&limit=500") => call<{ notifications: Notification[]; counts: NotificationCounts }>(`/api/notifications?${query}`),
  readNotifications: (ids: string[]) => post<{ notifications: Notification[] }>("/api/notifications/read", { ids }),
  dismissNotification: (id: string) => post<{ notifications: Notification[] }>(`/api/notifications/${id}/dismiss`, {}),
  dismissAllNotifications: (projectId?: string) => post<{ notifications: Notification[] }>("/api/notifications/dismiss-all", { projectId }),
  dismissNotifications: (ids: string[]) => postIdBatches("/api/notifications/dismiss-all", ids),
  restoreNotifications: (ids: string[]) => postIdBatches("/api/notifications/restore", ids),
  notificationAction: (action: Notification["actions"][number]) => post(action.path, action.body ?? {}),
  notificationContext: (id: string) => call<{ context: NotificationContext }>(`/api/notifications/${id}/context`),
  notificationBrief: (id: string) => call<{ brief: string | null; key: string | null }>(`/api/notifications/${id}/brief`),
  replyToNotification: (id: string, content: string) => post<{ ok: true; mode: ReplyMode }>(`/api/notifications/${id}/reply`, { content }),
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
  patchVaultItem: (projectId: string, id: string, patch: { title?: string; reextract?: true; pinned?: boolean }) =>
    call<{ item: VaultItem }>(`/api/projects/${projectId}/vault/${id}`, { method: "PATCH", json: patch }),
  convertVaultItem: (projectId: string, id: string) => post<{ noteId: string }>(`/api/projects/${projectId}/vault/${id}/convert`, {}),
  deleteVaultItem: (projectId: string, id: string) => call(`/api/projects/${projectId}/vault/${id}`, { method: "DELETE" }),
  promoteVaultIdea: (projectId: string, id: string, ideaId: string, to: "note" | "task") =>
    post<{ item: VaultItem; noteId?: string; taskId?: string }>(`/api/projects/${projectId}/vault/${id}/promote`, { ideaId, to }),
  projectInstructions: (id: string) => call<{ content: string }>(`/api/projects/${id}/instructions`),
  saveProjectInstructions: (id: string, content: string, expectedContent: string) => call(`/api/projects/${id}/instructions`, { method: "PUT", json: { content, expectedContent } }),
  projectConnectors: (id: string) => call<{ config: import("@/lib/projects/connectors").ConnectorConfig; revision: string | null; error: string | null }>(`/api/projects/${id}/connectors`),
  saveProjectConnectors: (id: string, config: unknown, revision: string) => call(`/api/projects/${id}/connectors`, { method: "PUT", json: { config, revision } }),
  revealWorkspace: (id: string, repoId?: string) => post(`/api/workspaces/${id}/reveal${repoId ? `?repo=${encodeURIComponent(repoId)}` : ""}`, {}),
  // Projects
  getProject: (id: string) => call<{ project: Project }>(`/api/projects/${id}`),
  listProjects: () => call<{ projects: ProjectSummary[] }>("/api/projects"),
  createProject: (body: CreateProjectBody) =>
    post<{ project: Project; repos: RepoResult<ProjectRepo>[] }>("/api/projects", body),
  pickFolder: (body: { prompt?: string; defaultPath?: string } = {}) =>
    post<{ path: string | null }>("/api/fs/pick-folder", body),
  listDirs: (path: string) => call<DirListing>(`/api/fs/list?path=${encodeURIComponent(path)}`),
  renameProject: (id: string, name: string) => call(`/api/projects/${id}`, { method: "PATCH", json: { name } }),
  deleteProject: (id: string) => call(`/api/projects/${id}`, { method: "DELETE" }),
  // The repos of a project
  listProjectRepos: (id: string) => call<{ repos: ProjectRepo[] }>(`/api/projects/${id}/repos`),
  addProjectRepo: (id: string, body: RepoSpec) => post<{ repo: ProjectRepo }>(`/api/projects/${id}/repos`, body),
  removeProjectRepo: (id: string, repoId: string) => call(`/api/projects/${id}/repos/${repoId}`, { method: "DELETE" }),
  // Workspaces
  listWorkspaces: (projectId: string) =>
    call<{ workspaces: WorkspaceSummary[] }>(`/api/workspaces?projectId=${encodeURIComponent(projectId)}`),
  createWorkspace: (body: {
    projectId: string;
    name?: string;
    worktree?: boolean;
    branch?: string;
    baseRef?: string;
    /** Repos to include; all of the project's when omitted. */
    repoIds?: string[];
  }) =>
    post<{ workspace: Workspace }>("/api/workspaces", body),
  updateWorkspace: (id: string, body: { name?: string; status?: "active" | "archived"; visibility?: "project" | "workspace" }) =>
    call(`/api/workspaces/${id}`, { method: "PATCH", json: body }),
  deleteWorkspace: (id: string, opts: { worktree?: boolean } = {}) =>
    call<{ ok: true; retainedDirectory?: string }>(`/api/workspaces/${id}?worktree=${opts.worktree ? 1 : 0}`, { method: "DELETE" }),
  getHarvest: (id: string) => call<import("@/lib/projects/harvest").HarvestData>(`/api/workspaces/${id}/harvest`),
  harvestWorkspace: (id: string, body: { memory: string | null; noteIds: string[] }) => post(`/api/workspaces/${id}/harvest`, body),
  proposeHarvest: (id: string) => post<{ sessionId: string }>(`/api/workspaces/${id}/harvest/propose`, {}),
  harvestProposalStatus: (id: string, sessionId: string) =>
    call<{ proposal: import("@/lib/memory/types").MemoryProposal | null; state: "proposed" | "working" | "awaiting" | "stopped" }>(`/api/workspaces/${id}/harvest/propose?sessionId=${encodeURIComponent(sessionId)}`),
  // Memory proposals: reviewable changes to project memory (lib/memory).
  getMemoryProposal: (id: string) => call<import("@/lib/memory/service").MemoryReview>(`/api/memory-proposals/${id}`),
  applyMemoryProposal: (id: string, body: { choices: import("@/lib/memory/types").MemoryItemChoice[]; memoryHash: string; document?: string }) =>
    post<import("@/lib/memory/service").ApplyResult>(`/api/memory-proposals/${id}/apply`, body),
  rejectMemoryProposal: (id: string) => post<{ proposal: import("@/lib/memory/types").MemoryProposal }>(`/api/memory-proposals/${id}/reject`, {}),
  workspaceRuntime: (id: string) => call<RuntimeSnapshot>(`/api/workspaces/${id}/runtime`),
  workspaceProcess: (id: string, body:
    | { action: "setup" | "run" | "shell" }
    | { action: "stop"; kind: ProcessKind }
    | { action: "input"; processId: string; data?: string; cols?: number; rows?: number }
  ) => post(`/api/workspaces/${id}/runtime`, body),
  workspaceGit: (id: string) => call<{ git: Awaited<ReturnType<typeof workspaceGitState>> }>(`/api/workspaces/${id}/git`),
  /** Without `repoId` the action covers every repo in the workspace. */
  workspaceGitAction: (id: string, action: string, deleteAfter = false, repoId?: string) =>
    post<{ ok: boolean; deleted: boolean }>(`/api/workspaces/${id}/git`, { action, deleteAfter, ...(repoId ? { repoId } : {}) }),
  checkpoints: (id: string) => call<{ checkpoints: Checkpoint[] }>(`/api/workspaces/${id}/checkpoints`),
  rewind: (id: string, checkpointId: string) => post<{ recovery: Checkpoint }>(`/api/workspaces/${id}/checkpoints`, { checkpointId }),
  /** `repos` lists every repo of a multi-repo workspace (primary first); empty for single-repo ones. */
  workspaceChanges: (id: string) =>
    call<{ changes: WorkspaceChanges | null; repos: RepoChanges[] }>(`/api/workspaces/${id}/changes`),
  workspaceFileDiff: (id: string, path: string, repoId?: string) =>
    call<{ diff: string }>(
      `/api/workspaces/${id}/changes?path=${encodeURIComponent(path)}${repoId ? `&repo=${encodeURIComponent(repoId)}` : ""}`,
    ),
  workspacePr: (id: string, repoId?: string) =>
    call<{ status: WorkspacePrStatus }>(`/api/workspaces/${id}/pr${repoId ? `?repo=${encodeURIComponent(repoId)}` : ""}`),
  workspaceFileRoots: (id: string) => call<{ roots: FileRoot[] }>(`/api/workspaces/${id}/files`),
  workspaceDirectory: (id: string, root: string, dir: string) =>
    call<{ entries: FileEntry[] }>(`/api/workspaces/${id}/files?root=${encodeURIComponent(root)}&dir=${encodeURIComponent(dir)}`),
  readWorkspaceFile: (id: string, root: string, path: string) =>
    call<FileContent>(`/api/workspaces/${id}/files/content?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  workspaceFileVersion: (id: string, root: string, path: string) =>
    call<{ version: string }>(`/api/workspaces/${id}/files/content?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&versionOnly=1`),
  /** Resolves with `conflict: true` and the disk content when the file changed since `baseVersion`. */
  saveWorkspaceFile: async (id: string, root: string, path: string, body: { content: string; baseVersion: string; force?: boolean }) => {
    const res = await fetch(`/api/workspaces/${id}/files/content?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return data as Extract<FileContent, { kind: "text" }> & { conflict: true };
    if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
    return data as { conflict: false; version: string };
  },
  workspaceArtifacts: (id: string) => call<{ artifacts: Artifact[] }>(`/api/workspaces/${id}/artifacts`),
  sessionContext: (id: string) => call<{ items: import("@/lib/context/types").ContextViewItem[] }>(`/api/sessions/${id}/context`),
  attachContext: (id: string, ref: { kind: "note"; scope: import("@/lib/notes/types").NoteScope; id: string } | { kind: "task" | "vault"; id: string }) =>
    post<{ items: import("@/lib/context/types").ContextViewItem[] }>(`/api/sessions/${id}/context`, ref),
  contextItemAction: (id: string, itemId: string, action: "update" | "remove" | "keep") =>
    post<{ items: import("@/lib/context/types").ContextViewItem[] }>(`/api/sessions/${id}/context/${itemId}`, { action }),
  listContextSets: (projectId: string) => call<{ sets: import("@/lib/context/types").ContextSet[] }>(`/api/projects/${projectId}/context-sets`),
  createContextSet: (projectId: string, body: import("@/lib/context/schema").ContextSetInput) =>
    post<{ set: import("@/lib/context/types").ContextSet }>(`/api/projects/${projectId}/context-sets`, body),
  updateContextSet: (id: string, patch: import("@/lib/context/schema").ContextSetPatch) =>
    call<{ set: import("@/lib/context/types").ContextSet }>(`/api/context-sets/${id}`, { method: "PATCH", json: patch }),
  deleteContextSet: (id: string) => call<{ ok: true }>(`/api/context-sets/${id}`, { method: "DELETE" }),
  noteSessions: (path: string) => call<{ sessions: { sessionId: string; title: string; itemId: string; changed: boolean }[] }>(`/api/context/note-sessions?path=${encodeURIComponent(path)}`),
  // Memory (project or workspace scope)
  getMemory: (scope: "projects" | "workspaces", id: string) =>
    call<{ path: string; content: string }>(`/api/${scope}/${id}/memory`),
  putMemory: (scope: "projects" | "workspaces", id: string, content: string, expectedContent: string) =>
    call(`/api/${scope}/${id}/memory`, { method: "PUT", json: { content, expectedContent } }),
  listRepoFolders: (id: string) => call<{ folders: import("@/lib/projects/types").RepoFolder[] }>(`/api/projects/${id}/repo-folders`),
  addRepoFolder: (id: string, body: { repoId?: string | null; path: string; label?: string; files?: string[] | null }) => post<{ folder: import("@/lib/projects/types").RepoFolder }>(`/api/projects/${id}/repo-folders`, body),
  setRepoFolderFiles: (id: string, folderId: string, files: string[] | null) => call(`/api/projects/${id}/repo-folders/${folderId}`, { method: "PATCH", json: { files } }),
  listRepoFolderFiles: (id: string, body: { repoId: string; path: string }) => post<{ files: { id: string; title: string; updatedAt: string }[] }>(`/api/projects/${id}/repo-folders/files`, body),
  removeRepoFolder: (id: string, folderId: string) => call(`/api/projects/${id}/repo-folders/${folderId}`, { method: "DELETE" }),
  suggestRepoFolders: (id: string) => post<{ candidates: { repoId: string | null; repoName: string; path: string; count: number }[] }>(`/api/projects/${id}/repo-folders/suggest`, {}),
  // Notes (project or workspace scope). Memory is the note with id "memory".
  listNotes: (scope: NoteScopeKind, id: string) => call<{ notes: NoteMeta[]; dir: string }>(`/api/${scope}/${id}/notes`),
  noteCounts: () => call<{ counts: Record<string, number> }>("/api/notes/counts"),
  listAllNotes: () => call<{ projects: NoteFolder[] }>("/api/notes"),
  getNote: (scope: NoteScopeKind, id: string, noteId: string) =>
    call<{ note: Note }>(`/api/${scope}/${id}/notes/${noteId}`),
  createNote: (scope: NoteScopeKind, id: string, body: { id?: string; title?: string; markdown?: string } & Partial<NoteFlags> = {}) =>
    post<{ note: Note }>(`/api/${scope}/${id}/notes`, body),
  patchNote: (scope: NoteScopeKind, id: string, noteId: string, body: { expectedUpdatedAt?: string; title?: string; markdown?: string; task?: { line: number; text: string; done: boolean } } & Partial<NoteFlags>) =>
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
  sendTask: (id: string, body: { sessionId?: string; workspaceId?: string; worker?: boolean }) => post<{ sessionId: string; workspaceId: string; href: string } | { taskId: string; queued: true; reason: string; href: null }>(`/api/tasks/${id}/send`, body),
  taskImportCount: (scope: NoteImportScope) => call<{ count: number; folders: string[] }>(`/api/tasks/import-notes?${new URLSearchParams(scope)}`),
  importNoteTasks: (scope: NoteImportScope) => post<{ imported: number }>("/api/tasks/import-notes", scope),
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
    projectId?: string;
    boardId?: string;
    workspaceId?: string;
    cwd?: string;
    model?: string;
    permissionMode?: string;
    prompt?: string;
    images?: PromptImage[];
    resumeSdkSessionId?: string;
    title?: string;
    contextSetId?: string;
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
