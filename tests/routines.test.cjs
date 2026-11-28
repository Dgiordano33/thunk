/* eslint-disable @typescript-eslint/no-require-imports -- The compiler hook exercises server TypeScript through Node’s CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
// Resolve the "@/..." alias the client-safe modules use.
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
const cron = require("../lib/routines/cron.ts");
const prompt = require("../lib/routines/prompt.ts");
const { RoutineInputSchema, RoutinePatchSchema } = require("../lib/routines/schema.ts");

test("cron validation accepts five fields only", () => {
  assert.equal(cron.cronError("0 9 * * 1-5"), null);
  assert.match(cron.cronError("* * * * * *"), /five fields/);
  assert.match(cron.cronError("bogus"), /five fields/);
  assert.ok(cron.cronError("99 * * * *"));
});

test("next runs honour the timezone", () => {
  const after = new Date("2026-11-09T12:00:00Z"); // Monday
  const next = cron.computeNextRun("0 9 * * *", "America/New_York", after);
  assert.equal(next.toISOString(), "2026-11-09T14:00:00.000Z");
  assert.equal(cron.computeNextRun(null, null, after), null);
  const runs = cron.nextRuns("*/15 * * * *", "UTC", 3, after);
  assert.deepEqual(runs.map((d) => d.toISOString()), ["2026-11-09T12:15:00.000Z", "2026-11-09T12:30:00.000Z", "2026-11-09T12:45:00.000Z"]);
  assert.equal(cron.isValidTimezone("Europe/Berlin"), true);
  assert.equal(cron.isValidTimezone("Mars/Olympus"), false);
});

test("cron descriptions", () => {
  assert.equal(cron.describeCron("0 9 * * 1-5"), "Weekdays 09:00");
  assert.equal(cron.describeCron("0 * * * *"), "Hourly");
  assert.equal(cron.describeCron("0 */6 * * *"), "Every 6h");
  assert.equal(cron.describeCron("30 8 * * 1"), "Mondays 08:30");
  assert.equal(cron.describeCron("5 4 1 * *"), "5 4 1 * *");
});

test("prompt templates fill event fields and leave unknowns empty", () => {
  const payload = { pr: { url: "https://github.com/a/b/pull/7", title: "Fix it" } };
  assert.equal(prompt.renderPrompt("Review {{event.pr.url}} ({{ event.pr.title }}) on {{event.type}}", "pr_opened", payload), "Review https://github.com/a/b/pull/7 (Fix it) on pr_opened");
  assert.equal(prompt.renderPrompt("Exit {{event.exitCode}}.", "manual", null), "Exit .");
  assert.equal(prompt.renderPrompt("{{payload}}", "webhook", { ref: "main" }), '{\n  "ref": "main"\n}');
  assert.equal(prompt.renderPrompt("{{event.pr}}", "pr_opened", payload), JSON.stringify(payload.pr));
});

test("summary fence parsing, with fallback", () => {
  const md = "Did things.\n\n```routine-summary\noutcome: changes\nsummary: Fixed two lint errors\n  and bumped a dep.\npr: https://github.com/a/b/pull/12\n```\n";
  assert.deepEqual(prompt.parseRoutineSummary(md), { outcome: "changes", summary: "Fixed two lint errors and bumped a dep.", pr: "https://github.com/a/b/pull/12" });
  assert.equal(prompt.parseRoutineSummary("```routine-summary\noutcome: nothing\nsummary: All clean.\npr: none\n```").pr, null);
  const long = "x".repeat(700);
  assert.equal(prompt.parseRoutineSummary(long).summary.length, 601);
  assert.equal(prompt.parseRoutineSummary(long).outcome, null);
  assert.equal(prompt.findPrUrl("see https://github.com/a/b/pull/3 then https://github.com/a/b/pull/4."), "https://github.com/a/b/pull/4");
});

test("routine schema defaults and cross-field checks", () => {
  const ok = RoutineInputSchema.parse({ projectId: "p", name: "Lint", prompt: "Run lint", model: "claude-sonnet-5-5" });
  assert.equal(ok.targetKind, "ephemeral");
  assert.equal(ok.permissionMode, "acceptEdits");
  assert.equal(ok.maxRunsPerDay, 24);
  const bad = RoutineInputSchema.safeParse({ projectId: "p", name: "Lint", prompt: "x", model: "m", scheduleCron: "* * * * * *", scheduleTz: "Nowhere/Land", targetKind: "workspace" });
  assert.equal(bad.success, false);
  const messages = bad.error.issues.map((i) => i.message).join(" | ");
  assert.match(messages, /Schedule/);
  assert.match(messages, /timezone/);
  assert.match(messages, /workspace/);
  assert.equal(RoutinePatchSchema.safeParse({ enabled: false }).success, true);
});


test("delivery trigger schema and prompt payloads", () => {
  const events = ["ci_failed", "review_requested", "deploy_ready"];
  assert.deepEqual(RoutinePatchSchema.parse({ events }).events, events);
  assert.equal(RoutinePatchSchema.safeParse({ events: ["unknown_delivery_event"] }).success, false);
  assert.equal(prompt.renderPrompt("Check {{event.previewUrl}} for {{event.pr.branch}}", "deploy_ready", { previewUrl: "https://preview.example/", pr: { branch: "topic" } }), "Check https://preview.example/ for topic");
});

// Server-side runs: real runner, scheduler and in-memory repo, with the agent and git layers stubbed.
const archived = [];
const removed = [];
const fakes = {
  db: null,
  workspaceContext: async () => null,
  prepareWorkspace: async () => {},
  getSession: () => null,
  isTerminated: () => true,
  createSession: async (input) => input,
  getSessionRow: async () => null,
};
const project = { id: "p", name: "Town", dataKey: "town", repos: [] };
const agent = {
  closeSession() {},
  getSession: (id) => fakes.getSession(id),
  isTerminated: (live) => fakes.isTerminated(live),
  listLiveSessions: () => [],
  pushUserMessage() {},
  subscribe: () => () => {},
  startSession: () => new Promise(() => {}), // A run that never ends holds its slot.
};
const projectsModule = {
  getWorkspaceContext: (id) => fakes.workspaceContext(id),
  contextForDirectory: async () => null,
  createWorkspace: async ({ name }) => ({ id: `ws-${name}`, slug: name, name, cwd: "/nowhere/wt", repos: [], branch: `thunk/${name}`, status: "active" }),
  removeWorkspace: async (id) => void removed.push(id),
};
const stubs = {
  "server-only": {},
  "../server": { db: () => fakes.db },
  "./persist": {},
  "./transcripts": { deleteTranscripts() {} },
  "./session-registry": {
    closeSession() {},
    createSession: (input) => fakes.createSession(input),
    evictSession() {},
    getSession: (id) => fakes.getSession(id),
    isTerminated: (live) => fakes.isTerminated(live),
    listLiveSessions: () => [],
  },
  "./report": { collectReport: async () => ({ summary: "", diffStat: null, prUrl: null }), writeRunNote: async () => ({ id: null }) },
  "./delivery-poll": { pollDeliveryRoutines: async () => {} },
  "./pr-poll": { pollPullRequests: async () => {} },
  "./triggers": { onRunFailed: async () => {} },
  "./projects": { getProject: async () => project },
  "@/lib/agent": agent,
  "@/lib/env": { env: {} },
  "@/lib/projects": projectsModule,
  "@/lib/projects/archive": { archiveWorkspace: async (id) => void archived.push(id) },
  "@/lib/projects/delivery": { ensureDeliveryPolling() {}, workspaceDeliveries: () => [] },
  "@/lib/projects/events": { projectEvents: () => ({ on() {} }) },
  "@/lib/projects/git": { tryGit: async () => null },
  "@/lib/projects/runtime": { prepareWorkspace: (ctx) => fakes.prepareWorkspace(ctx) },
  "@/lib/prompts/context": { expandCommand: async (text) => text },
  "@/lib/db/repo/messages": { loadEvents: async () => [], maxSeq: async () => 0 },
  "@/lib/db/repo/projects": { getProject: async () => project },
  "@/lib/db/repo/sessions": { upsertSession: async () => {}, getSessionRow: (id) => fakes.getSessionRow(id), listSessionRows: async () => [], deleteSessionRow: async () => {} },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  return Object.hasOwn(stubs, request) ? stubs[request] : load.call(this, request, parent, isMain);
};
const repo = require("../lib/db/repo/routines.ts");
const { routinesState } = require("../lib/routines/state.ts");
const runner = require("../lib/routines/runner.ts");
const triggers = require("../lib/db/repo/routine-triggers.ts");
const { dispatchTriggers, BUSY_GIVE_UP_MS } = require("../lib/routines/dispatch.ts");
const { ensureScheduler } = require("../lib/routines/scheduler.ts");
const { resumeSession } = require("../lib/agent/index.ts");
const webhook = require("../app/api/routines/[id]/webhook/route.ts");
const activity = require("../app/api/ambient/activity/route.ts");

test.after(() => clearInterval(routinesState.timer));

const newRoutine = (name, fields = {}) =>
  repo.insertRoutine({ projectId: "p", name, prompt: "Go", model: "claude-sonnet-5-5", permissionMode: "acceptEdits", targetKind: "workspace", targetWorkspaceId: "target", scheduleCron: null, scheduleTz: null, events: [], webhookToken: null, enabled: true, catchUp: "skip", maxRunsPerDay: 24, maxRunMinutes: 30, nextRunAt: null, ...fields });
async function eventually(check) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Timed out");
}

test("a restart's catch-up obeys the concurrency cap and archives interrupted per-run worktrees", async () => {
  fakes.workspaceContext = async () => ({ project, workspace: { id: "target", slug: "target", status: "active" } });
  const interrupted = await newRoutine("interrupted", { targetKind: "ephemeral", targetWorkspaceId: null });
  await repo.insertRun({ routineId: interrupted.id, triggerSource: "cron", status: "running", workspaceId: "ws-interrupted" });
  const due = new Date(Date.now() - 60_000).toISOString();
  const routines = await Promise.all([1, 2, 3, 4, 5].map((n) => newRoutine(`due-${n}`, { catchUp: "once", scheduleCron: "0 9 * * *", scheduleTz: "UTC", nextRunAt: due })));

  ensureScheduler();
  const runs = async () => (await Promise.all(routines.map((r) => repo.listRuns(r.id)))).flat();
  await eventually(async () => (await runs()).filter((r) => r.status === "running").length === 3);
  assert.equal((await runs()).length, 3);
  // The two without a slot wait in the outbox instead of being skipped.
  const waiting = (await Promise.all(routines.map((r) => triggers.listTriggers(r.id)))).flat().filter((t) => t.status === "pending");
  assert.equal(waiting.length, 2);
  assert.match(waiting[0].error, /3 routine runs already in progress/);
  assert.ok(waiting.every((t) => t.payload.catchUp === true));
  assert.deepEqual(archived, ["ws-interrupted"]);
  routinesState.active.clear();
  for (const t of waiting) await triggers.updateTrigger(t.id, { status: "skipped" });
});

test("a failed run on a fresh worktree archives it and keeps the worktree", async () => {
  fakes.prepareWorkspace = async () => { throw new Error("Setup failed"); };
  archived.length = 0;
  const routine = await newRoutine("doomed", { targetKind: "ephemeral", targetWorkspaceId: null });
  const run = await runner.startRun(routine, "manual");
  await eventually(async () => (await repo.getRun(run.id)).status === "failed");
  assert.equal(archived.length, 1);
  assert.match(archived[0], /^ws-doomed-/);
  assert.deepEqual(removed, []);
  assert.equal((await repo.getRun(run.id)).error, "Setup failed");
  assert.equal(routinesState.active.has(routine.id), false);
});

test("an open run stays active even when skip rows fill the recent window", async (t) => {
  const { testDb } = require("./helpers/test-db.cjs");
  const db = await testDb();
  t.after(() => db.close());
  const [project] = await db.query("insert into projects (name, data_key, slug) values ('Town', 'town', 'town') returning id");
  const [routine] = await db.query("insert into routines (project_id, name, prompt, model) values ($1, 'Nightly', 'go', 'm') returning id", [project.id]);
  await db.query("insert into routine_runs (routine_id, trigger_source, status, created_at) values ($1, 'cron', 'running', '2026-11-08T08:00:00Z')", [routine.id]);
  await db.query("insert into routine_runs (routine_id, trigger_source, status, error, created_at) select $1, 'cron', 'cancelled', 'Skipped: busy', '2026-11-08T12:00:00Z' from generate_series(1, 50)", [routine.id]);
  fakes.db = db;
  try {
    const [summary] = await repo.listRoutines();
    assert.equal(summary.projectName, "Town");
    assert.equal(summary.activeRun.status, "running");
    assert.equal(summary.lastRun.status, "running");
  } finally {
    fakes.db = null;
  }
});

test("the routine system prompt names the trigger when it is known", () => {
  const origin = { kind: "routine", routineId: "r", runId: "x", routineName: "Nightly" };
  assert.match(prompt.routineSystemPrompt({ ...origin, trigger: "ci_failed" }), /\*\*Nightly\*\* \(trigger: ci_failed\)/);
  assert.doesNotMatch(prompt.routineSystemPrompt(origin), /trigger:/);
});

test("sessions in archived workspaces can't be resumed, including ones still registered from before the archive", async () => {
  const created = [];
  fakes.createSession = async (input) => (created.push(input.id), input);
  const ctx = (status) => ({ project, workspace: { id: "w", status } });
  const row = { id: "s", workspaceId: "w", model: "m", permissionMode: "default", createdAt: "" };

  fakes.getSessionRow = async () => row;
  fakes.workspaceContext = async () => ctx("archived");
  await assert.rejects(resumeSession("s"), /archived/);

  fakes.getSession = () => ({ meta: { workspaceId: "w", model: "m", permissionMode: "default", createdAt: "" }, ctx: ctx("active"), seq: 0, events: [] });
  await assert.rejects(resumeSession("s"), /archived/);
  assert.deepEqual(created, []);

  fakes.workspaceContext = async () => ctx("active");
  await resumeSession("s");
  fakes.getSession = () => null;
  await resumeSession("s");
  assert.equal(created.length, 2);
});

test("the webhook stops reading an oversized body at the limit", async () => {
  fakes.workspaceContext = async () => ({ project, workspace: { id: "target", slug: "target", status: "active" } });
  fakes.prepareWorkspace = async () => {};
  const routine = await newRoutine("hook", { webhookToken: "secret" });
  const post = (body, headers = {}) =>
    webhook.POST(new Request("http://localhost/x?token=secret", { method: "POST", body, headers, duplex: "half" }), { params: Promise.resolve({ id: routine.id }) });

  // Never ends, so a handler that buffers the whole body would hang here.
  let pulls = 0;
  const endless = new ReadableStream({ pull: (c) => { pulls++; c.enqueue(new Uint8Array(16 * 1024)); } });
  assert.equal((await post(endless)).status, 413);
  assert.ok(pulls < 10);
  assert.equal((await post("{}", { "content-length": String(1024 * 1024) })).status, 413);

  const accepted = await post(JSON.stringify({ ref: "main" }));
  assert.equal(accepted.status, 202);
  const { runId } = await accepted.json();
  assert.deepEqual((await repo.getRun(runId)).triggerPayload, { ref: "main" });
  routinesState.active.clear();
});

test("ambient activity names each run's routine and project", async () => {
  const routine = await newRoutine("visible");
  const run = await repo.insertRun({ routineId: routine.id, triggerSource: "manual", status: "running" });
  const { runs } = await (await activity.GET(new Request("http://localhost/"), {})).json();
  const found = runs.find((r) => r.id === run.id);
  assert.equal(found.routineName, "visible");
  assert.equal(found.projectName, "Town");
  await repo.updateRun(run.id, { status: "succeeded" });
});

test("manual starts enforce daily and concurrent limits, reserving before async checks", async () => {
  routinesState.active.clear();
  const capped = await newRoutine("daily-capped", { maxRunsPerDay: 1 });
  await repo.insertRun({ routineId: capped.id, triggerSource: "manual", status: "succeeded" });
  await assert.rejects(runner.startRun(capped, "manual"), (e) => e.status === 429 && /daily limit/.test(e.message));
  assert.equal(routinesState.active.has(capped.id), false);
  fakes.workspaceContext = () => new Promise(() => {});
  const routines = await Promise.all([1, 2, 3, 4].map((n) => newRoutine(`manual-${n}`)));
  const results = await Promise.allSettled(routines.map((r) => runner.startRun(r, "manual")));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 429);
  await assert.rejects(runner.startRun(routines[0], "manual"), (e) => e.status === 409);
  routinesState.active.clear();
});

test("task events fill task placeholders", () => {
  const payload = { task: { id: "t-1", title: "Flaky login test", body: "Fails on CI" } };
  assert.equal(prompt.renderPrompt("Fix {{event.task.title}} ({{event.task.id}}): {{event.task.body}} on {{event.type}}", "task_created", payload), "Fix Flaky login test (t-1): Fails on CI on task_created");
  assert.ok(prompt.PROMPT_PLACEHOLDERS.includes("{{event.task.id}}"));
});

test("routine context defaults to empty and only accepts note refs and task UUIDs", () => {
  const base = { projectId: "p", name: "n", prompt: "do it", model: "m" };
  assert.deepEqual(RoutineInputSchema.parse(base).context, { notes: [], taskIds: [] });
  const context = { notes: [{ scope: { kind: "projects", id: "p" }, id: "abc123" }], taskIds: ["aaaaaaaa-1111-4111-8111-111111111111"] };
  assert.deepEqual(RoutineInputSchema.parse({ ...base, context }).context, context);
  assert.equal(RoutinePatchSchema.safeParse({ context: { notes: [], taskIds: ["nope"] } }).success, false);
  assert.equal(RoutinePatchSchema.safeParse({ context: { notes: [{ scope: { kind: "elsewhere", id: "p" }, id: "x" }], taskIds: [] } }).success, false);
  assert.equal(RoutinePatchSchema.safeParse({ events: ["task_created", "task_completed"] }).success, true);
});

test("routine system prompt points filed work at the project and at attached context", () => {
  const text = prompt.routineSystemPrompt({ kind: "routine", routineId: "r", runId: "x", routineName: "Triage", trigger: "task_created" });
  assert.match(text, /project scope/);
  assert.match(text, /Context for this run/);
});

// Durable triggers (lib/routines/dispatch.ts): the outbox between a poller and startRun.
const hang = () => new Promise(() => {});
/** Take every run slot with runs that aren't real, as if other routines were busy. */
const fillSlots = () => { for (let i = 0; i < 12; i++) routinesState.active.set(`busy-${i}`, { runId: `busy-${i}`, routineId: `busy-${i}`, sessionId: null, cancel() {} }); };
const minutesFrom = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60_000);

async function triggerDb(t, { fail } = {}) {
  const { testDb } = require("./helpers/test-db.cjs");
  const real = await testDb();
  t.after(() => { fakes.db = null; routinesState.active.clear(); return real.close(); });
  // `fail` makes every routine_runs read throw, so startRun fails after the routine is loaded.
  const db = { kind: real.kind, query: (sql, params) => (fail?.() && /from routine_runs/.test(sql) ? Promise.reject(new Error("database is down")) : real.query(sql, params)) };
  const [p] = await real.query("insert into projects (name, data_key, slug) values ('Town', 'town', 'town') returning id");
  const [r] = await real.query("insert into routines (project_id, name, prompt, model, schedule_cron, schedule_tz, next_run_at) values ($1, 'Nightly', 'go', 'm', '0 9 * * *', 'UTC', now() - interval '1 minute') returning id, next_run_at", [p.id]);
  fakes.db = db;
  return { db: real, projectId: p.id, routineId: r.id, slot: r.next_run_at };
}

test("a crash between queuing a trigger and starting it loses nothing and doubles nothing", async (t) => {
  routinesState.active.clear();
  fakes.workspaceContext = hang;
  const { db, routineId, slot } = await triggerDb(t);
  const key = `cron:${routineId}:${slot}`;
  // The tick queued the firing and moved the cursor in one statement, then the process died.
  assert.equal(await triggers.enqueueTriggers(routineId, [{ source: "cron", dedupeKey: key }], { nextRunAt: "2030-01-01T09:00:00.000Z" }), 1);
  const [routine] = await db.query("select next_run_at from routines where id = $1", [routineId]);
  assert.equal(routine.next_run_at, "2030-01-01T09:00:00+00:00");
  assert.equal((await db.query("select * from routine_runs")).length, 0);

  // A replay of the same slot (the cursor write was lost, say) is a no-op.
  assert.equal(await triggers.enqueueTriggers(routineId, [{ source: "cron", dedupeKey: key }], { nextRunAt: "2030-01-01T09:00:00.000Z" }), 0);

  // After the restart the dispatcher finds it and starts it, once.
  await dispatchTriggers();
  await dispatchTriggers();
  const runs = await db.query("select id, trigger_source from routine_runs");
  assert.equal(runs.length, 1);
  const [trigger] = await triggers.listTriggers(routineId);
  assert.equal(trigger.status, "started");
  assert.equal(trigger.runId, runs[0].id);
  assert.equal(runs[0].trigger_source, "cron");
});

test("a duplicate poll queues each event once", async () => {
  const routine = await newRoutine("dupe-poll");
  const event = { source: "pr_opened", dedupeKey: `pr:${routine.id}:https://github.com/a/b/pull/1`, payload: { pr: { number: 1 } } };
  assert.equal(await triggers.enqueueTriggers(routine.id, [event], { triggerState: { prSeenAt: "2026-11-01T00:00:00Z" } }), 1);
  assert.equal(await triggers.enqueueTriggers(routine.id, [event, { ...event, dedupeKey: `${event.dedupeKey}2` }]), 1);
  assert.equal((await triggers.listTriggers(routine.id)).length, 2);
  assert.equal((await repo.getRoutine(routine.id)).triggerState.prSeenAt, "2026-11-01T00:00:00Z");
  for (const t of await triggers.listTriggers(routine.id)) await triggers.updateTrigger(t.id, { status: "skipped" });
});

test("a trigger waits for a full slot to free, and is skipped after an hour of waiting", async () => {
  routinesState.active.clear();
  fakes.workspaceContext = hang;
  const routine = await newRoutine("waits");
  await triggers.enqueueTriggers(routine.id, [{ source: "cron", dedupeKey: `cron:${routine.id}:a` }]);
  const [queued] = await triggers.listTriggers(routine.id);

  fillSlots();
  await dispatchTriggers(minutesFrom(queued.createdAt, 1));
  let [trigger] = await triggers.listTriggers(routine.id);
  assert.equal(trigger.status, "pending");
  assert.match(trigger.error, /already in progress/);
  assert.ok(trigger.nextAttemptAt > minutesFrom(queued.createdAt, 1).toISOString(), "backs off");
  assert.equal(trigger.attempts, 0, "a busy slot isn't a failed attempt");
  assert.deepEqual(await repo.listRuns(routine.id), [], "no Skipped row while it waits");

  routinesState.active.clear();
  await dispatchTriggers(minutesFrom(queued.createdAt, 10));
  [trigger] = await triggers.listTriggers(routine.id);
  assert.equal(trigger.status, "started");
  const [run] = await repo.listRuns(routine.id);
  assert.equal(trigger.runId, run.id);
  assert.equal(run.status, "queued");

  // The routine is still running: a second firing waits for it, then gives up after an hour.
  await triggers.enqueueTriggers(routine.id, [{ source: "cron", dedupeKey: `cron:${routine.id}:b` }]);
  const second = (await triggers.listTriggers(routine.id)).find((t) => t.status === "pending");
  await dispatchTriggers(minutesFrom(second.createdAt, 30));
  assert.equal((await triggers.listTriggers(routine.id)).find((t) => t.id === second.id).status, "pending");
  await dispatchTriggers(new Date(new Date(second.createdAt).getTime() + BUSY_GIVE_UP_MS + 60_000));
  const gaveUp = (await triggers.listTriggers(routine.id)).find((t) => t.id === second.id);
  assert.equal(gaveUp.status, "skipped");
  const skipRow = await repo.getRun(gaveUp.runId);
  assert.ok(repo.isSkip(skipRow));
  assert.match(skipRow.error, /previous run is still in progress for an hour/);
  routinesState.active.clear();
});

test("the daily limit skips a trigger straight away, with the reason", async () => {
  routinesState.active.clear();
  const routine = await newRoutine("capped-trigger", { maxRunsPerDay: 1 });
  await repo.insertRun({ routineId: routine.id, triggerSource: "manual", status: "succeeded" });
  await triggers.enqueueTriggers(routine.id, [{ source: "cron", dedupeKey: `cron:${routine.id}:a` }]);
  await dispatchTriggers();
  const [trigger] = await triggers.listTriggers(routine.id);
  assert.equal(trigger.status, "skipped");
  assert.match(trigger.error, /daily limit of 1 runs reached/);
  assert.ok(repo.isSkip(await repo.getRun(trigger.runId)));
});

test("a startRun that throws is retried three times, then fails with an Inbox card", async (t) => {
  routinesState.active.clear();
  let failing = true;
  const { db, routineId } = await triggerDb(t, { fail: () => failing });
  await triggers.enqueueTriggers(routineId, [{ source: "cron", dedupeKey: `cron:${routineId}:x` }]);
  let [trigger] = await triggers.listTriggers(routineId);
  let now = minutesFrom(trigger.createdAt, 1);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await dispatchTriggers(now);
    [trigger] = await triggers.listTriggers(routineId);
    assert.equal(trigger.status, "pending");
    assert.equal(trigger.attempts, attempt);
    assert.equal(trigger.error, "database is down");
    assert.equal((await triggers.listDueTriggers(now)).length, 0, "waits before the next try");
    now = minutesFrom(trigger.nextAttemptAt, 0.1);
  }
  await dispatchTriggers(now);
  [trigger] = await triggers.listTriggers(routineId);
  assert.equal(trigger.status, "failed");
  assert.equal(trigger.attempts, 4);
  assert.equal(routinesState.active.has(routineId), false, "the slot is released");
  const cards = await db.query("select kind, title, detail from notifications where subject_key = $1", [`routine-trigger:${trigger.id}:failed`]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, "run_failed");
  assert.match(cards[0].detail, /database is down/);
  failing = false;
});

test("on restart an interrupted run is retried once from its trigger when the routine catches up", async () => {
  routinesState.active.clear();
  fakes.workspaceContext = hang;
  const restart = async () => {
    clearInterval(routinesState.timer);
    routinesState.timer = null;
    routinesState.booted = false;
    routinesState.active.clear();
    ensureScheduler();
  };
  const routine = await newRoutine("retried", { catchUp: "once" });
  const other = await newRoutine("not-retried", { catchUp: "skip" });
  for (const r of [routine, other]) {
    await triggers.enqueueTriggers(r.id, [{ source: "pr_opened", dedupeKey: `pr:${r.id}:1`, payload: { pr: { number: 1 } } }]);
    await dispatchTriggers();
  }
  // Earlier tests' runs would be interrupted (and retried) too; close them so this one gets a slot.
  for (const run of await repo.listOpenRuns()) if (![routine.id, other.id].includes(run.routineId)) await repo.updateRun(run.id, { status: "cancelled" });
  await restart();
  await eventually(async () => (await triggers.listTriggers(routine.id)).some((t) => t.dedupeKey.startsWith("retry:") && t.status === "started"));
  const retry = (await triggers.listTriggers(routine.id)).find((t) => t.dedupeKey.startsWith("retry:"));
  assert.deepEqual(retry.payload, { pr: { number: 1 } });
  assert.equal(retry.source, "pr_opened");
  const runs = await repo.listRuns(routine.id);
  assert.equal(runs.length, 2);
  assert.match(runs.find((r) => r.id !== retry.runId).error, /Interrupted/);
  assert.equal((await triggers.listTriggers(other.id)).length, 1, "no catch-up, no retry");

  // The retry is interrupted too: it isn't retried again.
  await restart();
  await eventually(async () => (await repo.getRun(retry.runId)).status === "failed");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await triggers.listTriggers(routine.id)).length, 2);
  routinesState.active.clear();
});
