import type { RevisionComment, RevisionStat } from "@/lib/revisions/build-payload";
import type { SessionMeta } from "@/lib/agent/types";
import type { DocComment } from "@/lib/documents/types";
import type { Project, ProjectSummary, Workspace, WorkspaceSummary } from "@/lib/projects/types";

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
  createWorkspace: (body: { projectId: string; name: string; worktree?: boolean; branch?: string; baseRef?: string }) =>
    post<{ workspace: Workspace }>("/api/workspaces", body),
  updateWorkspace: (id: string, body: { name?: string; status?: "active" | "archived" }) =>
    call(`/api/workspaces/${id}`, { method: "PATCH", json: body }),
  deleteWorkspace: (id: string, opts: { worktree?: boolean; memory?: boolean } = {}) =>
    call(`/api/workspaces/${id}?worktree=${opts.worktree ? 1 : 0}&memory=${opts.memory ? 1 : 0}`, { method: "DELETE" }),
  // Memory (project or workspace scope)
  getMemory: (scope: "projects" | "workspaces", id: string) =>
    call<{ path: string; content: string }>(`/api/${scope}/${id}/memory`),
  putMemory: (scope: "projects" | "workspaces", id: string, content: string) =>
    call(`/api/${scope}/${id}/memory`, { method: "PUT", json: { content } }),
  // Sessions
  createSession: (body: {
    workspaceId?: string;
    cwd?: string;
    model?: string;
    permissionMode?: string;
    prompt?: string;
    resumeSdkSessionId?: string;
    title?: string;
  }) => post<{ id: string; workspaceId: string }>("/api/sessions", body),
  getSession: (id: string) => call<{ session: SessionMeta }>(`/api/sessions/${id}`),
  listSessions: (opts: { workspaceId?: string; projectId?: string } = {}) =>
    call<{ sessions: SessionMeta[] }>(
      `/api/sessions?${new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][])}`,
    ),
  resume: (id: string) => post<{ session: SessionMeta; seq: number }>(`/api/sessions/${id}/resume`, {}),
  send: (id: string, content: string) => post<{ messageId: string }>(`/api/sessions/${id}/input`, { content }),
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
