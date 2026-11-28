// Shared between server and client. Keep free of server-only imports; runtime imports are relative so lib tests can load this file.
import type { HarnessEvent, Question, SessionOrigin, SessionState } from "@/lib/agent/types";
import { toolSummary } from "../agent/tool-summary.ts";
import type { Notification, NotificationKind } from "./types.ts";

/** One side of the conversation, as the Inbox shows it. `partial`: the agent is still writing this turn. */
export type ContextMessage = { role: "you" | "agent"; text: string; at: number; partial?: boolean };
/** How a typed reply reaches the agent: it answers a question, denies a tool call with a note, sends plan changes, or is a plain message. */
export type ReplyMode = "answer" | "deny" | "changes" | "message";
export type NotificationContext = {
  source: {
    project: string | null; workspace: string | null; session: string | null;
    /** What started the session when it wasn't a person: "Routine · Nightly checks". */
    origin: string | null;
    model: string | null; state: SessionState | null; live: boolean; startedAt: string | null; turns: number;
  };
  /** The first thing the session was asked to do. */
  goal: string | null;
  /** What the person has to do about this notification, in one sentence. */
  need: string;
  /** True while the agent is blocked on this notification. */
  blocking: boolean;
  thread: ContextMessage[];
  /** Tool calls since the person last spoke, oldest first. */
  activity: string[];
  /** Files the session has edited, most recent last. */
  files: string[];
  /** Still-pending questions, so the Inbox can answer ones with several parts or several picks. */
  questions: { requestId: string; items: Question[] } | null;
  reply: { mode: ReplyMode; placeholder: string; send: string } | null;
  /** Identifies the state a model-written brief describes; it changes when the conversation or the request does, not when the item is merely read. Null: nothing to summarize. */
  briefKey: string | null;
};

const THREAD_TAIL = 6;
const ACTIVITY_TAIL = 5;
const GOAL_LIMIT = 600;
const MESSAGE_LIMIT = 4000;
const clip = (text: string, limit: number) => { const t = text.trim(); return t.length > limit ? `${t.slice(0, limit).trimEnd()}…` : t; };
const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "ApplyPatch"]);

/** The request id a session notification was opened for, from `session:<id>:req:<requestId>`. */
export function requestIdOf(n: Pick<Notification, "subjectKey">): string | null {
  return /^session:[^:]+:req:(.+)$/.exec(n.subjectKey)?.[1] ?? null;
}

export function originLabel(origin: SessionOrigin | null | undefined, taskTitle?: string | null): string | null {
  switch (origin?.kind) {
    case "routine": return `Routine · ${origin.routineName}`;
    case "worker": return taskTitle ? `Worker on “${taskTitle}”` : origin.scout ? "Scout worker" : "Worker";
    case "chief": return "Project chief";
    case "top_chief": return "Relay";
    case "board": return "Canvas";
    case "memory": return "Memory proposal";
    default: return null;
  }
}

const INFO: Partial<Record<NotificationKind, string>> = {
  turn_finished: "The agent finished its turn. Nothing is required; reply to keep it going.",
  turn_failed: "The turn failed. Reply to retry or redirect it.",
  session_error: "The session hit an error. Reply to retry, or open it to see what happened.",
  worker_report: "A worker reported its result. Work completed does not mean reviewed or merged; inspect the report for blockers.",
  run_succeeded: "A routine run finished. Nothing is required.",
  run_failed: "A routine run failed. Open it to see the output.",
  script_failed: "A workspace script failed. Open the workspace to see its output.",
  deploy_ready: "A preview is ready to look at. Nothing is required.",
  pr_merged: "The pull request merged. Nothing is required.",
};
const ACTION: Partial<Record<NotificationKind, string>> = {
  question: "Answer so the agent can continue.",
  plan: "Review the plan, then approve it or reply with changes.",
  delegation_plan: "Review how the chief wants to split this work, then approve it or reply.",
  agent_request: "The agent asked for your help. Reply here or open the session.",
  session_stuck: "No activity for 10 minutes. Nudge it, or open the session to check on it.",
  run_needs_attention: "A routine run needs a look.",
  review_requested: "A pull request is waiting on your review.",
  ci_failed: "CI is failing on this pull request. This clears itself once checks pass.",
  ci_stuck: "Checks have been pending for 30 minutes.",
  memory_proposal: "An agent proposed changes to project memory. Review each change, then apply or reject.",
};

export function needFor(n: Pick<Notification, "kind" | "urgency" | "status">, opts: { toolName?: string | null; pending?: boolean } = {}): string {
  if (n.urgency === "info") return INFO[n.kind] ?? "For your information. Nothing is required.";
  if (n.status === "dismissed") return "Dismissed. The agent may still be waiting in its session.";
  if (n.status !== "open" || opts.pending === false) return "Already handled. Nothing is required.";
  if (n.kind === "permission") return `Allow or deny ${opts.toolName || "this tool call"} so the agent can continue.`;
  return ACTION[n.kind] ?? "Needs your attention.";
}

/** Whether a typed reply can reach an agent, and what it does there. `pending`: the request is still waiting in a live session. */
export function replyFor(n: Pick<Notification, "kind" | "sessionId">, pending: boolean): NotificationContext["reply"] {
  if (!n.sessionId || n.kind === "capture_ready") return null; // Relay has its own tracked reply composer.
  if (pending && n.kind === "question") return { mode: "answer", placeholder: "Answer in your own words…", send: "Send answer" };
  if (pending && n.kind === "permission") return { mode: "deny", placeholder: "Deny, and tell the agent what to do instead…", send: "Deny with note" };
  if (pending && n.kind === "plan") return { mode: "changes", placeholder: "Ask for changes to the plan…", send: "Request changes" };
  return { mode: "message", placeholder: "Reply to the agent…", send: "Send" };
}

/** Reads a session's events into the short account the Inbox shows: the goal, the last few exchanges, recent tool calls and edited files. */
export function digestEvents(events: HarnessEvent[]) {
  const messages: ContextMessage[] = [];
  const files: string[] = [];
  let activity: string[] = [];
  let goal: string | null = null;
  let turns = 0;
  let prose = "";
  let lastProse = "";
  let turnAt = 0;
  const touch = (path: string) => { if (!path) return; const i = files.indexOf(path); if (i >= 0) files.splice(i, 1); files.push(path); };
  for (const e of events) {
    switch (e.type) {
      case "user_message":
        if (e.kind === "prompt" && goal === null && e.content.trim()) goal = clip(e.content, GOAL_LIMIT);
        messages.push({ role: "you", at: e.ts, text: e.kind === "revision" ? "Sent document revisions." : clip(e.content, MESSAGE_LIMIT) || "Sent an image." });
        activity = [];
        break;
      case "turn_start": prose = ""; lastProse = ""; turnAt = e.ts; break;
      case "text_delta": prose += e.text; break;
      case "tool_use": {
        if (prose.trim()) lastProse = prose;
        prose = "";
        const summary = toolSummary(e.name, e.input);
        activity.push(summary ? `${e.name} · ${summary}` : e.name);
        if (EDIT_TOOLS.has(e.name)) {
          const input = (e.input ?? {}) as Record<string, unknown>;
          if (Array.isArray(input.changes)) for (const c of input.changes as { path?: string }[]) touch(c.path ?? "");
          else touch(typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "");
        }
        break;
      }
      case "plan_proposed": messages.push({ role: "agent", at: e.ts, text: clip(e.plan, MESSAGE_LIMIT) }); prose = ""; lastProse = ""; break;
      case "turn_complete": {
        const text = e.markdown.trim() || prose.trim() || lastProse.trim();
        if (text) messages.push({ role: "agent", at: e.ts, text: clip(text, MESSAGE_LIMIT) });
        prose = ""; lastProse = "";
        break;
      }
      case "result": turns++; break;
    }
  }
  // A turn still in flight (or parked on a request): show what the agent has said so far.
  const open = prose.trim() || lastProse.trim();
  if (open) messages.push({ role: "agent", at: turnAt || events.at(-1)?.ts || 0, text: clip(open, MESSAGE_LIMIT), partial: true });
  return { goal, turns, files, activity: activity.slice(-ACTIVITY_TAIL), messages };
}

export type ContextInput = {
  notification: Notification;
  events: HarnessEvent[];
  project: string | null; workspace: string | null;
  session: { title: string | null; model: string; status: SessionState; createdAt: string; origin?: SessionOrigin | null; live: boolean } | null;
  taskTitle?: string | null;
  /** Request ids still waiting on an answer in the live session. */
  pendingIds: string[];
};

export function buildContext(input: ContextInput): NotificationContext {
  const { notification: n, events, session } = input;
  const digest = digestEvents(events);
  const requestId = requestIdOf(n);
  const pending = Boolean(requestId && input.pendingIds.includes(requestId));
  const asked = requestId ? events.findLast((e) => "requestId" in e && e.requestId === requestId && (e.type === "permission_request" || e.type === "ask_question")) : undefined;
  // The first prompt is already shown as the goal; don't repeat it at the top of the thread.
  const thread = digest.messages.filter((m, i) => !(i === 0 && m.role === "you" && digest.goal && m.text.startsWith(digest.goal.replace(/…$/, "")))).slice(-THREAD_TAIL);
  const isRequest = n.kind === "permission" || n.kind === "question" || n.kind === "plan";
  return {
    source: {
      project: input.project, workspace: input.workspace, session: session?.title ?? null, origin: originLabel(session?.origin, input.taskTitle),
      model: session?.model ?? null, state: session?.status ?? null, live: session?.live ?? false, startedAt: session?.createdAt ?? null, turns: digest.turns,
    },
    goal: digest.goal,
    need: needFor(n, { toolName: asked?.type === "permission_request" ? asked.toolName : null, pending: isRequest && n.status === "open" ? pending : undefined }),
    blocking: n.status === "open" && n.urgency === "action" && (isRequest ? pending : n.kind === "agent_request" || n.kind === "delegation_plan"),
    thread, activity: digest.activity, files: digest.files.slice(-8),
    questions: pending && asked?.type === "ask_question" ? { requestId: requestId!, items: asked.questions } : null,
    reply: session ? replyFor(n, pending) : null,
    briefKey: session && (digest.messages.length > 0 || digest.activity.length > 0)
      ? [n.id, pending ? 1 : 0, digest.messages.length, digest.messages.at(-1)?.at ?? 0, digest.messages.at(-1)?.text.length ?? 0, digest.activity.length].join(":")
      : null,
  };
}
