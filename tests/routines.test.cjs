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
const project = { id: "p", name: "Town", root: "/nowhere", kind: "repo" };
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
  createWorkspace: async ({ name }) => ({ id: `ws-${name}`, slug: name, name, worktreePath: "/nowhere/wt", branch: `thunk/${name}`, status: "active" }),
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
  "@/lib/supabase/repo/messages": { loadEvents: async () => [], maxSeq: async () => 0 },
  "@/lib/supabase/repo/projects": { getProject: async () => project },
  "@/lib/supabase/repo/sessions": { upsertSession: async () => {}, getSessionRow: (id) => fakes.getSessionRow(id), listSessionRows: async () => [], deleteSessionRow: async () => {} },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  return Object.hasOwn(stubs, request) ? stubs[request] : load.call(this, request, parent, isMain);
};
const repo = require("../lib/supabase/repo/routines.ts");
const { routinesState } = require("../lib/routines/state.ts");
const runner = require("../lib/routines/runner.ts");
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
  await eventually(async () => (await runs()).length === 5 && (await runs()).filter((r) => r.status === "running").length === 3);
  const skipped = (await runs()).filter((r) => r.status === "cancelled");
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].error, /3 routine runs already in progress/);
  assert.deepEqual(archived, ["ws-interrupted"]);
  routinesState.active.clear();
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

test("an open run stays active even when skip rows fill the recent window", async () => {
  const row = (id, status, created_at) => ({ id, routine_id: "r", status, created_at, cost_usd: 0, error: status === "cancelled" ? "Skipped: busy" : null });
  const skips = Array.from({ length: 50 }, (_, i) => row(`skip-${i}`, "cancelled", "2026-11-08T12:00:00Z"));
  const open = row("open", "running", "2026-11-08T08:00:00Z");
  const query = (table) => {
    const q = {};
    const chain = {
      select: () => chain, order: () => chain, gte: () => chain, eq: () => chain,
      limit: (n) => ((q.limit = n), chain),
      in: (column, values) => ((q[column] = values), chain),
      then: (resolve) => resolve({
        error: null,
        data: table === "routines" ? [{ id: "r", projects: { name: "Town" } }] : q.status ? [open] : q.limit ? skips : [],
      }),
    };
    return chain;
  };
  fakes.db = { from: query };
  try {
    const [summary] = await repo.listRoutines();
    assert.equal(summary.activeRun.id, "open");
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
