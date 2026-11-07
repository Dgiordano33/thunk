import type { RevisionComment, RevisionStat } from "@/lib/revisions/build-payload";
import type { SessionMeta } from "@/lib/agent/types";
import type { DocComment } from "@/lib/documents/types";

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
  createSession: (body: { cwd: string; model?: string; permissionMode?: string; prompt?: string }) =>
    post<{ id: string }>("/api/sessions", body),
  getSession: (id: string) => call<{ session: SessionMeta }>(`/api/sessions/${id}`),
  listSessions: (cwd?: string) =>
    call<{ sessions: SessionMeta[] }>(`/api/sessions${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
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
