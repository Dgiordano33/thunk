import assert from "node:assert/strict";
import test from "node:test";
import { noticeFor, summarizeUsage, workspaceActivity } from "./summary.ts";

test("notifications describe actionable requests and final results, not streaming deltas", () => {
  assert.equal(noticeFor({ type: "permission_request" }), "Needs permission");
  assert.equal(noticeFor({ type: "ask_question" }), "Has a question");
  assert.equal(noticeFor({ type: "plan_proposed" }), "Plan ready for review");
  assert.equal(noticeFor({ type: "result", isError: false }), "Turn finished");
  assert.equal(noticeFor({ type: "result", isError: true }), "Turn failed");
  assert.equal(noticeFor({ type: "text_delta" }), null);
});

test("attention and errors take precedence over running sessions in the same workspace", () => {
  const running = { workspaceId: "w", pending: 0, status: "running" };
  const awaiting = { workspaceId: "w", pending: 1, status: "awaiting" };
  const error = { workspaceId: "w", pending: 0, status: "error" };
  assert.equal(workspaceActivity([running], "w"), "Running");
  assert.equal(workspaceActivity([running, awaiting, error], "w"), "Needs attention");
  assert.equal(workspaceActivity([running, error], "w"), "Session error");
  assert.equal(workspaceActivity([awaiting], "other"), null);
  assert.equal(workspaceActivity([{ ...running, status: "idle" }], "w"), null);
});

test("usage merges live and persisted events once and groups by local calendar day", () => {
  const first = { sessionId: "s1", seq: 10, ts: Date.parse("2026-11-07T02:00:00Z"), costUsd: 0.25 };
  const second = { sessionId: "s2", seq: 10, ts: Date.parse("2026-11-07T12:00:00Z"), costUsd: 0.75 };
  const summary = summarizeUsage([first, first, second, { ...first, seq: 11, costUsd: NaN }, { ...first, seq: 12, costUsd: -1 }], new Map([["s1", "w1"], ["s2", "w2"]]), "America/New_York");
  assert.equal(summary.total, 1);
  assert.deepEqual(summary.days, [{ name: "2026-11-07", cost: 0.75 }, { name: "2026-11-06", cost: 0.25 }]);
  assert.deepEqual(summary.workspaces, [{ id: "w2", cost: 0.75 }, { id: "w1", cost: 0.25 }]);
  assert.deepEqual(summarizeUsage([], new Map(), "UTC"), { total: 0, days: [], workspaces: [] });
});
