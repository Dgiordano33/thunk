import { captureWorkspaceCheckpoint } from "@/lib/projects/checkpoints";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { withWorkspaceLock } from "@/lib/projects/runtime";
import { expandCommand } from "@/lib/prompts/context";
import type { PromptImage } from "@/lib/prompts/schema";
import "server-only";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeDriver } from "./claude-driver";
import { createCodexDriver } from "./codex/driver";
import type { WorkspaceContext } from "@/lib/projects";
import type { SessionOrigin } from "@/lib/routines/types";
import { providerOf, type HarnessEvent, type HarnessEventBody, type SessionMeta, type SessionState } from "./types";

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

/**
 * One agent runtime (Claude Agent SDK query, or a Codex app-server thread) behind a live session.
 * Drivers translate their runtime's stream into harness events via `emit`.
 */
export type AgentDriver = {
  /** Pump the runtime until it exits. Rejects if it crashes. */
  run(): Promise<void>;
  send(content: string, images?: PromptImage[]): void;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  /** Stop accepting input and shut the runtime down. Idempotent. */
  close(): void;
  readonly isClosed: boolean;
};

export type LiveSession = {
  id: string;
  meta: Omit<SessionMeta, "live">;
  /** The project and workspace this session runs in (cwd, config root, memory). */
  ctx: WorkspaceContext;
  driver: AgentDriver;
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
  queuedMessages: { id: string; content: string; images: PromptImage[] }[];
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
  /** SDK session id (Claude) or thread id (Codex) to resume. */
  resume?: string;
  /** Continue numbering after persisted events. */
  seqStart?: number;
  /** In-memory history to carry over when replacing a terminated session. */
  events?: HarnessEvent[];
  origin?: SessionOrigin | null;
};

export async function createSession(input: CreateSessionInput): Promise<LiveSession> {
  const id = input.id ?? crypto.randomUUID();
  const existing = registry.get(id);
  if (existing) return existing;

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
      origin: input.origin ?? null,
    },
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
    queuedMessages: [],
  } as unknown as LiveSession;

  const dequeued = new Set(live.events.filter((e) => e.type === "message_dequeued").map((e) => e.messageId));
  for (const event of live.events) {
    if (event.type === "user_message" && event.queued && !dequeued.has(event.messageId)) {
      live.queuedMessages.push({
        id: event.messageId,
        content: event.kind === "prompt" ? await expandCommand(event.content, input.ctx.project.root) : event.content,
        images: event.images ?? [],
      });
    }
  }

  // Drivers read project memory from disk.
  const createDriver = providerOf(input.model) === "codex" ? createCodexDriver : createClaudeDriver;
  const driver = await createDriver(live, { resume: input.resume });
  if (registry.has(id)) {
    driver.close(); // raced with a concurrent create
    return registry.get(id)!;
  }
  live.driver = driver;
  registry.set(id, live);

  for (const hook of g.__thunkSessionHooks!) hook(live);

  setState(live, "idle", { resumed: Boolean(input.resume) });
  void runSession(live);
  return live;
}

/** Pump the driver until it ends, then park the session as closed or errored. */
async function runSession(live: LiveSession) {
  try {
    await live.driver.run();
    if (live.meta.status !== "closed") setState(live, "closed");
  } catch (err) {
    const tail = live.stderrTail.slice(-5).join("").trim();
    const message = err instanceof Error ? err.message : String(err);
    emit(live, { type: "error", message: tail ? `${message}\n${tail}` : message });
    setState(live, "error");
  } finally {
    // Stays registered (history, status) until resumeSession replaces it.
    releaseSession(live);
  }
}

export function getSession(id: string) {
  return registry.get(id);
}

export function listLiveSessions() {
  return [...registry.values()];
}

/** The agent runtime has exited or crashed; it can only be resumed by replacing the session. */
export function isTerminated(live: LiveSession) {
  return live.meta.status === "closed" || live.meta.status === "error";
}

/** Deny parked tool requests and shut the runtime's input and subprocess. Idempotent. */
export function releaseSession(live: LiveSession) {
  for (const [requestId, req] of live.pending) {
    req.resolve({ behavior: "deny", message: "Session closed." });
    live.pending.delete(requestId);
  }
  try {
    live.driver.close();
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
  if (state === "idle" && live.queuedMessages?.length) {
    const next = live.queuedMessages.shift()!;
    emit(live, { type: "message_dequeued", messageId: next.id });
    live.meta.status = "running";
    dispatchMessage(live, next.id, next.content, next.images);
    state = "running";
  }
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
  opts: { kind?: "prompt" | "revision"; documentId?: string; stat?: { edits: number; comments: number }; images?: PromptImage[]; expandedContent?: string } = {},
) {
  if (live.driver.isClosed) throw new Error("Session is closed");
  const queued = live.meta.status === "running" || live.meta.status === "awaiting";
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
    images: opts.images,
    queued,
  });
  if (queued) {
    (live.queuedMessages ??= []).push({ id: messageId, content: opts.expandedContent ?? content, images: opts.images ?? [] });
  } else {
    setState(live, "running");
    dispatchMessage(live, messageId, opts.expandedContent ?? content, opts.images);
  }
  return messageId;
}

function dispatchMessage(live: LiveSession, messageId: string, content: string, images?: PromptImage[]) {
  void (async () => {
    if (workspaceRepoTargets(live.ctx).length) {
      // Queue behind other workspace operations (another session's checkpoint, a rewind) rather than failing the turn.
      await withWorkspaceLock(live.ctx.workspace.id, async () => {
        try {
          const { skipped } = await captureWorkspaceCheckpoint(live.ctx, live.id, messageId, content);
          if (skipped.length) emit(live, { type: "error", message: `Checkpoint skipped some repos; rewind won't restore them for this turn: ${skipped.join("; ")}` });
        } catch (err) {
          // A Git conflict must not prevent asking the agent to resolve it.
          emit(live, { type: "error", message: `Checkpoint unavailable; this turn will run without rewind: ${(err as Error).message}` });
        }
      }, { wait: true });
    }
    if (!live.driver.isClosed && live.meta.status === "running") live.driver.send(content, images);
  })().catch((err: Error) => {
    emit(live, { type: "error", message: `Could not start turn: ${err.message}` });
    setState(live, "error");
  });
}

export function resolvePending(live: LiveSession, requestId: string, result: PermissionResult) {
  const req = live.pending.get(requestId);
  if (!req) return null;
  live.pending.delete(requestId);
  req.resolve(result);
  if (live.pending.size === 0 && live.meta.status === "awaiting") setState(live, "running");
  return req;
}
