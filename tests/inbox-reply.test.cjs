/* eslint-disable @typescript-eslint/no-require-imports -- Use the existing TypeScript compiler test pattern. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

/** Compile one server module and hand it the given modules in place of its imports. */
function load(file, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class WorkspaceArchivedError extends Error {}

const question = { question: "Which database?", header: "Database", multiSelect: false, options: [] };
const base = { id: "n", kind: "question", urgency: "action", status: "open", sessionId: "s", subjectKey: "session:s:req:r1" };

/** A reply module wired to one fake session. `live: null` means the session has stopped and must be resumed. */
function fixture({ live = "running", events = [], pending = [], resume } = {}) {
  const log = { resolved: [], emitted: [], pushed: [], resumed: 0, notificationsResolved: [], revisions: [] };
  const session = {
    id: "s", events, ctx: { root: "/repo" }, lastPlan: { documentId: "d1", version: 1, changesRequested: false },
    pending: new Map(pending.map(([id, kind]) => [id, { kind, input: { original: true } }])),
  };
  const resumed = { ...session, pending: new Map(), fresh: true };
  const agent = {
    WorkspaceArchivedError,
    getSession: () => live ? session : undefined,
    isTerminated: () => live === "terminated",
    resolvePending: (l, id, result) => { l.pending.delete(id); log.resolved.push([id, result]); },
    emit: (_l, event) => log.emitted.push(event),
    resumeSession: async () => { log.resumed++; return resume ? resume() : live === "running" ? session : resumed; },
    pushUserMessage: (l, content, opts) => log.pushed.push([l.fresh ? "resumed" : "live", content, opts.expandedContent]),
  };
  const planChanges = load("lib/revisions/plan-changes.ts", {
    "server-only": {}, "@/lib/agent": agent,
    "@/lib/db/repo/documents": { updateDocument: async (id, patch) => log.revisions.push(["document", id, patch.status]), insertRevision: async (r) => log.revisions.push(["revision", r.documentId, r.payload]) },
    "./build-payload": load("lib/revisions/build-payload.ts", { diff: require("diff") }),
  });
  const { replyToNotification } = load("lib/notifications/reply.ts", {
    "server-only": {}, "@/lib/agent": agent, "@/lib/api/errors": { HttpError },
    "@/lib/projects/repos": { sessionConfigRoot: (ctx) => ctx.root },
    "@/lib/prompts/context": { expandCommand: async (content, root) => `${content} @${root}` },
    "@/lib/revisions/plan-changes": planChanges,
    "./context": { requestIdOf: (n) => /^session:[^:]+:req:(.+)$/.exec(n.subjectKey)?.[1] ?? null },
    "./service": { resolveBySubject: async (key) => log.notificationsResolved.push(key) },
  });
  return { reply: replyToNotification, log, session };
}

test("a reply answers a pending question with the person's words for every part", async () => {
  const two = [question, { ...question, question: "Which region?" }];
  const f = fixture({ pending: [["r1", "question"]], events: [{ type: "ask_question", requestId: "r1", questions: two }] });
  assert.equal(await f.reply(base, "Postgres in eu-west"), "answer");
  assert.deepEqual(f.log.resolved, [["r1", { behavior: "allow", updatedInput: { original: true, answers: { "Which database?": "Postgres in eu-west", "Which region?": "Postgres in eu-west" } } }]]);
  assert.equal(f.log.emitted[0].type, "question_resolved");
  assert.equal(f.log.pushed.length, 0, "an answer is not also sent as a message");
});
test("a reply denies a pending permission and passes the note to the agent", async () => {
  const f = fixture({ pending: [["r1", "permission"]] });
  assert.equal(await f.reply({ ...base, kind: "permission" }, "Run only the inbox spec"), "deny");
  assert.deepEqual(f.log.resolved, [["r1", { behavior: "deny", message: "The user denied this tool call and said: Run only the inbox spec" }]]);
  assert.deepEqual(f.log.emitted, [{ type: "permission_resolved", requestId: "r1", decision: "deny" }]);
});
test("a reply sends a pending plan back with the note as a change request on the whole plan", async () => {
  const plan = "# Plan\n\n1. Add the route\n2. Add the UI\n";
  const f = fixture({ pending: [["r1", "plan"]], events: [{ type: "plan_proposed", requestId: "r1", documentId: "d1", version: 1, plan }] });
  assert.equal(await f.reply({ ...base, kind: "plan" }, "Split step 2 & add <tests>"), "changes");
  const [[id, result]] = f.log.resolved;
  assert.equal(id, "r1"); assert.equal(result.behavior, "deny");
  assert.match(result.message, /^<document_revision document_id="d1" turn="1">/);
  assert.match(result.message, /requested changes\. Apply their edits and address every comment, then propose the revised plan again with ExitPlanMode/);
  assert.match(result.message, /\(no direct edits\)/);
  assert.match(result.message, /<comments count="1">\n<comment id="[^"]+" status="open" kind="change">\n {2}<quote><\/quote>\n {2}<context>The whole plan<\/context>\n {2}<body>Split step 2 &amp; add &lt;tests&gt;<\/body>/);
  assert.match(result.message, /<edited_document>\n# Plan\n\n1\. Add the route\n2\. Add the UI\n<\/edited_document>/);
  assert.deepEqual(f.log.emitted, [{ type: "plan_resolved", requestId: "r1", decision: "changes" }]);
  assert.equal(f.session.lastPlan.changesRequested, true, "the re-proposal links to this plan");
  assert.deepEqual(f.log.revisions.map((r) => r.slice(0, 2)), [["document", "d1"], ["revision", "d1"]]);
  assert.equal(f.log.revisions[0][2], "sent");
});
test("with nothing pending a reply is a message, and a stopped session is resumed first", async () => {
  const finished = { ...base, kind: "turn_finished", urgency: "info", subjectKey: "session:s:result:9" };
  const running = fixture();
  assert.equal(await running.reply(finished, "/review now"), "message");
  assert.deepEqual(running.log.pushed, [["live", "/review now", "/review now @/repo"]]);
  for (const live of [null, "terminated"]) {
    const stopped = fixture({ live, pending: [["r1", "question"]] });
    assert.equal(await stopped.reply(base, "Postgres"), "message", "a request left in a dead session can't be answered, so the words go as a message");
    assert.equal(stopped.log.resumed, 1);
    assert.deepEqual(stopped.log.pushed, [["resumed", "Postgres", "Postgres @/repo"]]);
    assert.equal(stopped.log.resolved.length, 0);
  }
});
test("replying settles an agent request, and failures to resume are reported, not swallowed", async () => {
  const request = { ...base, kind: "agent_request", subjectKey: "session:s:agent:1" };
  const f = fixture();
  await f.reply(request, "Use the staging key");
  assert.deepEqual(f.log.notificationsResolved, ["session:s:agent:1"]);
  await f.reply({ ...request, status: "resolved" }, "And rotate it");
  assert.equal(f.log.notificationsResolved.length, 1);
  await assert.rejects(fixture().reply({ ...base, sessionId: null }, "hi"), (e) => e.status === 409);
  await assert.rejects(fixture({ live: null, resume: async () => null }).reply(base, "hi"), (e) => e.status === 404);
  await assert.rejects(fixture({ live: null, resume: async () => { throw new WorkspaceArchivedError("Workspace is archived."); } }).reply(base, "hi"), (e) => e.status === 409 && /archived/.test(e.message));
  await assert.rejects(fixture({ live: null, resume: async () => { throw new Error("spawn failed"); } }).reply(base, "hi"), /spawn failed/);
});

test("a brief is written once per state, shared by concurrent readers, and a failure is not retried at once", async (t) => {
  delete globalThis.__thunkBriefs; delete globalThis.__thunkBriefRuns;
  const { briefFor } = load("lib/notifications/brief.ts", {
    "server-only": {}, "@/lib/agent/types": { providerOf: () => "claude" }, "@/lib/env": { env: { DEFAULT_MODEL: "claude-opus-5-5" } },
    "./brief-prompt": { BRIEF_SYSTEM: "", briefPrompt: (n, ctx) => `${n.title}|${ctx.need}`, cleanBrief: (s) => s.trim() || null },
  });
  const n = { id: "n", title: "Allow Bash?" };
  const prompts = [];
  const run = async (prompt) => { prompts.push(prompt); await new Promise((r) => setTimeout(r, 5)); return " Waiting on you. "; };
  const ctx = { briefKey: "n:open:1", need: "Allow or deny" };
  assert.deepEqual(await Promise.all([briefFor(n, ctx, run), briefFor(n, ctx, run)]), ["Waiting on you.", "Waiting on you."]);
  assert.equal(await briefFor(n, ctx, run), "Waiting on you.");
  assert.deepEqual(prompts, ["Allow Bash?|Allow or deny"], "one model call for three readers");
  await briefFor(n, { ...ctx, briefKey: "n:resolved:0" }, run);
  assert.equal(prompts.length, 2, "a new state gets a new brief");
  assert.equal(await briefFor(n, { ...ctx, briefKey: null }, run), null);
  assert.equal(prompts.length, 2, "nothing to summarize, nothing asked");
  const log = t.mock.method(console, "error", () => {});
  let failures = 0;
  const failing = async () => { failures++; throw new Error("signed out"); };
  assert.equal(await briefFor(n, { ...ctx, briefKey: "n:bad" }, failing), null);
  assert.equal(await briefFor(n, { ...ctx, briefKey: "n:bad" }, failing), null);
  assert.equal(failures, 1); assert.equal(log.mock.callCount(), 1);
});
