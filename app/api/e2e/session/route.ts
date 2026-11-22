import { z } from "zod";
import { emit, registerSession, setState, type LiveSession } from "@/lib/agent";
import type { HarnessEventBody, SessionState } from "@/lib/agent/types";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";

export const dynamic = "force-dynamic";

const Body = z.object({
  workspaceId: z.string().min(1),
  title: z.string().optional(),
  status: z.enum(["idle", "running", "awaiting"]).default("idle"),
  events: z.array(z.record(z.string(), z.unknown())),
});

/**
 * Browser tests only: a live session with a scripted history and no agent behind it.
 * Requests in the history stay pending, so the approval routes work against it.
 */
export const POST = handle(async (req: Request) => {
  if (process.env.NEXT_PUBLIC_THUNK_E2E !== "1") throw new HttpError(404, "Not found");
  const body = await parseBody(req, Body);
  const ctx = await getWorkspaceContext(body.workspaceId);
  if (!ctx) throw new HttpError(404, "Workspace not found");
  const id = crypto.randomUUID();
  let closed = false;
  const live = {
    id,
    ctx,
    meta: {
      id, projectId: ctx.project.id, workspaceId: ctx.workspace.id, cwd: ctx.workspace.cwd, model: "claude-sonnet-5-5",
      permissionMode: "default", sdkSessionId: null, title: body.title ?? null, status: "starting" as SessionState,
      createdAt: new Date().toISOString(), origin: null,
    },
    events: [], seq: 0, subscribers: new Set(), pending: new Map(), turn: null, pendingRevision: null, lastPlan: null,
    pendingDelta: null, deltaTimer: null, stderrTail: [], queuedMessages: [],
  } as unknown as LiveSession;
  live.driver = {
    run: () => new Promise(() => {}),
    send: () => {},
    interrupt: async () => setState(live, "idle"),
    setModel: async () => {},
    setPermissionMode: async () => {},
    close: () => { closed = true; },
    get isClosed() { return closed; },
  };
  registerSession(live);
  const resolved = new Set(body.events.filter((e) => /_resolved$/.test(String(e.type))).map((e) => String(e.requestId)));
  for (const event of body.events as HarnessEventBody[]) {
    emit(live, event);
    if (event.type !== "permission_request" && event.type !== "ask_question" && event.type !== "plan_proposed") continue;
    if (resolved.has(event.requestId)) continue;
    live.pending.set(event.requestId, {
      kind: event.type === "permission_request" ? "permission" : event.type === "ask_question" ? "question" : "plan",
      toolUseId: event.toolUseId,
      toolName: event.type === "permission_request" ? event.toolName : event.type,
      input: (event.type === "permission_request" ? event.input : {}) as Record<string, unknown>,
      resolve: () => {},
    });
  }
  setState(live, live.pending.size ? "awaiting" : body.status);
  return Response.json({ id }, { status: 201 });
});
