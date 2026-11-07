import "server-only";
import { query, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./async-queue";
import { runSession } from "./event-bridge";
import { buildOptions } from "./options";
import type { WorkspaceContext } from "@/lib/projects";
import type { HarnessEvent, HarnessEventBody, SessionMeta, SessionState } from "./types";

export type PendingRequest = {
  kind: "permission" | "question" | "plan";
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  suggestions?: unknown[];
  resolve: (result: PermissionResult) => void;
};

export type TurnState = {
  id: string;
  /** Prose after the most recent tool call; becomes the turn's document. */
  segmentText: string;
  lastPartWasTool: boolean;
  /** A user message arrived mid-turn; the next API call starts a new turn. */
  split: boolean;
  streamedMessageIds: Set<string>;
};

export type LiveSession = {
  id: string;
  meta: Omit<SessionMeta, "live">;
  /** The project and workspace this session runs in (cwd, config root, memory). */
  ctx: WorkspaceContext;
  query: Query;
  input: AsyncQueue<SDKUserMessage>;
  events: HarnessEvent[];
  seq: number;
  subscribers: Set<(e: HarnessEvent) => void>;
  pending: Map<string, PendingRequest>;
  turn: TurnState | null;
  /** Set by a revision send; the next document becomes its child version. */
  pendingRevision: { documentId: string; version: number } | null;
  /** Last proposed plan, so a re-proposal after "request changes" links to it. */
  lastPlan: { documentId: string; version: number; changesRequested: boolean } | null;
  pendingDelta: Extract<HarnessEventBody, { type: "text_delta" | "thinking_delta" }> | null;
  deltaTimer: ReturnType<typeof setTimeout> | null;
  stderrTail: string[];
};

const MAX_EVENTS = 20_000;
const DELTA_COALESCE_MS = 30;

type Registry = Map<string, LiveSession>;

// Pinned to globalThis so HMR module reloads don't orphan live subprocesses.
const g = globalThis as typeof globalThis & {
  __thunkRegistry?: Registry;
  __thunkShutdownHooked?: boolean;
  __thunkSessionHooks?: ((live: LiveSession) => void)[];
};
const registry: Registry = (g.__thunkRegistry ??= new Map());
g.__thunkSessionHooks ??= [];

if (!g.__thunkShutdownHooked) {
  g.__thunkShutdownHooked = true;
  const shutdown = () => {
    for (const live of registry.values()) closeSession(live.id);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/** Register a callback run for every session created (used by persistence). */
export function onSessionCreated(hook: (live: LiveSession) => void) {
  const hooks = g.__thunkSessionHooks!;
  // Replace on HMR instead of stacking duplicates.
  const key = hook.name;
  const idx = hooks.findIndex((h) => h.name === key);
  if (idx >= 0) hooks[idx] = hook;
  else hooks.push(hook);
}

export type CreateSessionInput = {
  id?: string;
  ctx: WorkspaceContext;
  model: string;
  permissionMode: string;
  title?: string | null;
  createdAt?: string;
  /** SDK session id to resume. */
  resume?: string;
  /** Continue numbering after persisted events. */
  seqStart?: number;
  /** In-memory history to carry over when replacing a terminated session. */
  events?: HarnessEvent[];
};

export async function createSession(input: CreateSessionInput): Promise<LiveSession> {
  const id = input.id ?? crypto.randomUUID();
  const existing = registry.get(id);
  if (existing) return existing;

  const inputQueue = new AsyncQueue<SDKUserMessage>();
  const live = {
    id,
    ctx: input.ctx,
    meta: {
      id,
      projectId: input.ctx.project.id,
      workspaceId: input.ctx.workspace.id,
      cwd: input.ctx.workspace.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      sdkSessionId: input.resume ?? null,
      title: input.title ?? null,
      status: "starting" as SessionState,
      createdAt: input.createdAt ?? new Date().toISOString(),
    },
    input: inputQueue,
    events: input.events ?? [],
    seq: input.seqStart ?? 0,
    subscribers: new Set(),
    pending: new Map(),
    turn: null,
    pendingRevision: null,
    lastPlan: null,
    pendingDelta: null,
    deltaTimer: null,
    stderrTail: [],
  } as unknown as LiveSession;

  // Options read project memory from disk.
  const options = await buildOptions(live, { resume: input.resume });
  if (registry.has(id)) return registry.get(id)!; // raced with a concurrent create
  live.query = query({ prompt: inputQueue, options });
  registry.set(id, live);

  for (const hook of g.__thunkSessionHooks!) hook(live);

  setState(live, "idle", { resumed: Boolean(input.resume) });
  void runSession(live);
  return live;
}

export function getSession(id: string) {
  return registry.get(id);
}

export function listLiveSessions() {
  return [...registry.values()];
}

/** The SDK query has exited or crashed; it can only be resumed by replacing the session. */
export function isTerminated(live: LiveSession) {
  return live.meta.status === "closed" || live.meta.status === "error";
}

/** Deny parked tool requests and shut the query's input and subprocess. Idempotent. */
export function releaseSession(live: LiveSession) {
  for (const [requestId, req] of live.pending) {
    req.resolve({ behavior: "deny", message: "Session closed." });
    live.pending.delete(requestId);
  }
  live.input.close();
  try {
    live.query.close();
  } catch {
    // already closed
  }
  flushDelta(live);
}

/** Drop a terminated session from the registry so a fresh one can take its id. */
export function evictSession(live: LiveSession) {
  if (registry.get(live.id) === live) registry.delete(live.id);
}

export function closeSession(id: string) {
  const live = registry.get(id);
  if (!live) return;
  releaseSession(live);
  setState(live, "closed");
  flushDelta(live);
  registry.delete(id);
}

export function subscribe(live: LiveSession, fn: (e: HarnessEvent) => void) {
  live.subscribers.add(fn);
  return () => live.subscribers.delete(fn);
}

export function setState(live: LiveSession, state: SessionState, extra: { resumed?: boolean } = {}) {
  live.meta.status = state;
  emit(live, {
    type: "status",
    state,
    permissionMode: live.meta.permissionMode,
    model: live.meta.model,
    ...extra,
  });
}

/** Emit an event. Text/thinking deltas are coalesced (~30ms) to keep SSE + React cheap. */
export function emit(live: LiveSession, body: HarnessEventBody) {
  if (body.type === "text_delta" || body.type === "thinking_delta") {
    const p = live.pendingDelta;
    if (p && p.type === body.type && p.turnId === body.turnId) {
      p.text += body.text;
    } else {
      flushDelta(live);
      live.pendingDelta = { ...body };
    }
    live.deltaTimer ??= setTimeout(() => flushDelta(live), DELTA_COALESCE_MS);
    return;
  }
  flushDelta(live);
  emitNow(live, body);
}

function flushDelta(live: LiveSession) {
  if (live.deltaTimer) clearTimeout(live.deltaTimer);
  live.deltaTimer = null;
  const p = live.pendingDelta;
  live.pendingDelta = null;
  if (p && p.text) emitNow(live, p);
}

function emitNow(live: LiveSession, body: HarnessEventBody) {
  const event = { ...body, seq: ++live.seq, sessionId: live.id, ts: Date.now() } as HarnessEvent;
  live.events.push(event);
  if (live.events.length > MAX_EVENTS) live.events.splice(0, live.events.length - MAX_EVENTS);
  for (const fn of live.subscribers) {
    try {
      fn(event);
    } catch (err) {
      console.error("[thunk] subscriber failed", err);
    }
  }
}

export function pushUserMessage(
  live: LiveSession,
  content: string,
  opts: { kind?: "prompt" | "revision"; documentId?: string; stat?: { edits: number; comments: number } } = {},
) {
  if (live.input.isClosed) throw new Error("Session is closed");
  if (live.turn) live.turn.split = true;
  if (!live.meta.title && opts.kind !== "revision") {
    live.meta.title = content.replace(/\s+/g, " ").trim().slice(0, 80);
  }
  const messageId = crypto.randomUUID();
  emit(live, {
    type: "user_message",
    messageId,
    content,
    kind: opts.kind ?? "prompt",
    documentId: opts.documentId,
    stat: opts.stat,
  });
  live.input.push({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  });
  setState(live, "running");
  return messageId;
}

export function resolvePending(live: LiveSession, requestId: string, result: PermissionResult) {
  const req = live.pending.get(requestId);
  if (!req) return null;
  live.pending.delete(requestId);
  req.resolve(result);
  if (live.pending.size === 0 && live.meta.status === "awaiting") setState(live, "running");
  return req;
}
