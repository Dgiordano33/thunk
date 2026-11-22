import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, digestEvents, needFor, replyFor, requestIdOf } from "./context.ts";

let seq = 0;
const ev = (body) => ({ ...body, seq: ++seq, sessionId: "s", ts: seq * 1000 });
const question = { question: "Which database?", header: "Database", multiSelect: false, options: [{ label: "Postgres", description: "" }, { label: "SQLite", description: "" }] };
const history = () => [
  ev({ type: "user_message", messageId: "m1", content: "Add an inbox reply box", kind: "prompt" }),
  ev({ type: "turn_start", turnId: "t1" }),
  ev({ type: "text_delta", turnId: "t1", text: "Reading the inbox first." }),
  ev({ type: "tool_use", turnId: "t1", toolUseId: "u1", name: "Read", input: { file_path: "/repo/components/inbox/inbox.tsx" } }),
  ev({ type: "tool_use", turnId: "t1", toolUseId: "u2", name: "Edit", input: { file_path: "/repo/components/inbox/inbox.tsx" } }),
  ev({ type: "text_delta", turnId: "t1", text: "I need to know where replies are stored." }),
  ev({ type: "ask_question", requestId: "r1", toolUseId: "u3", questions: [question] }),
];
const notification = (over = {}) => ({ id: "n", kind: "question", urgency: "action", projectId: "p", workspaceId: "w", sessionId: "s", runId: null,
  subjectKey: "session:s:req:r1", title: "Which database?", detail: null, href: "/", actions: [], status: "open", readAt: null, resolvedAt: null, createdAt: "", updatedAt: "", ...over });
const session = { title: "Inbox reply", model: "claude-sonnet-5-5", status: "awaiting", createdAt: new Date(0).toISOString(), origin: null, live: true };
const input = (over = {}) => ({ notification: notification(), events: history(), project: "Thunk", workspace: "inbox", session, pendingIds: ["r1"], ...over });

test("a parked question shows the goal, what the agent said before asking, and an answer box", () => {
  const ctx = buildContext(input());
  assert.equal(ctx.goal, "Add an inbox reply box");
  assert.deepEqual(ctx.thread.map((m) => [m.role, m.text, Boolean(m.partial)]), [["agent", "I need to know where replies are stored.", true]]);
  assert.deepEqual(ctx.activity, ["Read · components/inbox/inbox.tsx", "Edit · components/inbox/inbox.tsx"]);
  assert.deepEqual(ctx.files, ["/repo/components/inbox/inbox.tsx"]);
  assert.equal(ctx.blocking, true);
  assert.equal(ctx.need, "Answer so the agent can continue.");
  assert.equal(ctx.reply.mode, "answer");
  assert.equal(ctx.questions.requestId, "r1");
  assert.deepEqual(ctx.source, { project: "Thunk", workspace: "inbox", session: "Inbox reply", origin: null, model: "claude-sonnet-5-5", state: "awaiting", live: true, startedAt: session.createdAt, turns: 0 });
});
test("once the request is gone a reply is a plain message and nothing is blocking", () => {
  const ctx = buildContext(input({ pendingIds: [] }));
  assert.equal(ctx.reply.mode, "message"); assert.equal(ctx.questions, null); assert.equal(ctx.blocking, false);
  assert.match(ctx.need, /Already handled/);
  assert.equal(buildContext(input({ session: null, events: [] })).reply, null, "no session, nothing to reply to");
});
test("finished turns keep the last exchanges and drop the first prompt, which is the goal", () => {
  const events = [...history().slice(0, 6),
    ev({ type: "turn_complete", turnId: "t1", documentId: "d", markdown: "Done. Replies go to the session.", version: 1 }),
    ev({ type: "result", subtype: "success", isError: false, costUsd: 0, numTurns: 1, durationMs: 1 }),
    ev({ type: "user_message", messageId: "m2", content: "Now add tests", kind: "prompt" })];
  const digest = digestEvents(events);
  assert.equal(digest.turns, 1); assert.deepEqual(digest.activity, [], "activity restarts when the person speaks");
  const ctx = buildContext(input({ events, pendingIds: [], notification: notification({ kind: "turn_finished", urgency: "info", status: "resolved", subjectKey: "session:s:result:8" }) }));
  assert.deepEqual(ctx.thread.map((m) => [m.role, m.text]), [["agent", "Done. Replies go to the session."], ["you", "Now add tests"]]);
  assert.match(ctx.need, /finished its turn/);
});
test("reply modes follow the pending request, and need names the tool", () => {
  assert.equal(replyFor({ kind: "permission", sessionId: "s" }, true).mode, "deny");
  assert.equal(replyFor({ kind: "plan", sessionId: "s" }, true).mode, "changes");
  assert.equal(replyFor({ kind: "agent_request", sessionId: "s" }, false).mode, "message");
  assert.equal(replyFor({ kind: "ci_failed", sessionId: null }, false), null);
  assert.equal(needFor({ kind: "permission", urgency: "action", status: "open" }, { toolName: "Bash" }), "Allow or deny Bash so the agent can continue.");
  assert.equal(requestIdOf({ subjectKey: "session:s:req:r1" }), "r1");
  assert.equal(requestIdOf({ subjectKey: "session:s:result:4" }), null);
});

test("the brief key follows the conversation and the request, and is absent when there is nothing to summarize", async () => {
  const events = history();
  const parked = buildContext(input({ events }));
  assert.ok(parked.briefKey);
  assert.equal(buildContext(input({ events })).briefKey, parked.briefKey, "same state, same key");
  assert.notEqual(buildContext(input({ events, pendingIds: [] })).briefKey, parked.briefKey, "answering changes it");
  assert.equal(buildContext(input({ events, notification: notification({ status: "resolved", readAt: "now" }) })).briefKey, parked.briefKey, "reading or resolving alone does not");
  assert.notEqual(buildContext(input({ events: [...events, ev({ type: "user_message", messageId: "m9", content: "Postgres", kind: "prompt" })] })).briefKey, parked.briefKey, "so does a new message");
  assert.equal(buildContext(input({ events: [] })).briefKey, null);
  assert.equal(buildContext(input({ session: null })).briefKey, null);
});
test("the brief prompt carries the same digest the panel shows, and the reply is cleaned to plain text", async () => {
  const { briefPrompt, cleanBrief } = await import("./brief-prompt.ts");
  const n = notification({ detail: "x".repeat(5000) });
  const prompt = briefPrompt(n, buildContext(input({ notification: n })));
  assert.match(prompt, /<notification>\nQuestion \(open\): Which database\?\nx{4000}…\n<\/notification>/);
  assert.match(prompt, /<source>\nThunk › inbox › Inbox reply\nsession is awaiting\n<\/source>/);
  assert.match(prompt, /<asked_to>\nAdd an inbox reply box\n<\/asked_to>/);
  assert.match(prompt, /<conversation>\nAgent: I need to know where replies are stored\.\n<\/conversation>/);
  assert.match(prompt, /<recent_tool_calls>\nRead · components\/inbox\/inbox\.tsx/);
  assert.match(prompt, /<needs>\nAnswer so the agent can continue\.\n<\/needs>/);
  assert.equal(cleanBrief("**TL;DR:** The agent\n\nis `waiting`."), "The agent is waiting.");
  assert.equal(cleanBrief("  \n "), null);
});
