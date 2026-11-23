import { test } from "node:test";
import assert from "node:assert/strict";
import { runReportMessage } from "./slack/report-message.ts";

const base = { routine: "Nightly <deps>", project: "thunk", status: "succeeded", summary: "Bumped 3 packages & ran tests.", diff: { files: 2, additions: 10, deletions: 4 }, prUrl: "https://github.com/x/y/pull/7", costUsd: 0.4567, error: null, noteUrl: "https://t/n", sessionUrl: null };

test("a run report shows the outcome, changes, cost, summary and links", () => {
  const json = JSON.stringify(runReportMessage(base));
  assert.match(json, /✅ \*Nightly &lt;deps&gt;\* succeeded/);
  assert.match(json, /\+10 −4 in 2 files/);
  assert.match(json, /\$0\.46/);
  assert.match(json, /Bumped 3 packages &amp; ran tests\./);
  assert.match(json, /pull\/7/);
  assert.match(json, /"Report"/);
  assert.doesNotMatch(json, /"Session"/);
});

test("failures carry the error, empty runs say so, and long summaries are cut", () => {
  const json = JSON.stringify(runReportMessage({ ...base, status: "failed", error: "Timed out", diff: { files: 0, additions: 0, deletions: 0 }, prUrl: null, summary: "x".repeat(3000) }));
  assert.match(json, /❌/);
  assert.match(json, /Error: Timed out/);
  assert.match(json, /no changes/);
  assert.ok(json.length < 2500);
});
