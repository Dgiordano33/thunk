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
