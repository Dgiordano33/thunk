import { test } from "node:test";
import assert from "node:assert/strict";
import { observedFor, parseClaimedEvidence, staleness, stripEvidence } from "./types.ts";
import { normalizeCriteria } from "../tasks/types.ts";

const report = [
  "Done.",
  "```worker-summary",
  "outcome: done",
  "summary: Fixed the redirect",
  "  and added a test",
  "branch: thunk/fix",
  "needs_person: none",
  "evidence:",
  "- c1 | pass | test | npm test: 42 passed | tests/login.test.ts",
  "- c2 | PASS | screenshot | Login page shows the error | /tmp/shot.png",
  "- c9 | fail | merge | not mine to claim | none",
  "- c3: could not check in this environment",
  "```",
].join("\n");

test("claimed evidence is read from the worker-summary block, one line per criterion", () => {
  const rows = parseClaimedEvidence(report, [{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
  assert.deepEqual(rows[0], { criterionId: "c1", status: "pass", type: "test", detail: "npm test: 42 passed", ref: "tests/login.test.ts" });
  assert.deepEqual(rows[1], { criterionId: "c2", status: "pass", type: "screenshot", detail: "Login page shows the error", ref: "/tmp/shot.png" });
  // Unknown criterion ids and types a worker cannot claim become notes; "none" is no ref.
  assert.deepEqual(rows[2], { criterionId: null, status: "fail", type: "note", detail: "not mine to claim", ref: null });
  assert.deepEqual(rows[3], { criterionId: "c3", status: "unknown", type: "note", detail: "could not check in this environment", ref: null });
  assert.deepEqual(parseClaimedEvidence("no summary block"), []);
});

test("the evidence field is stripped before the summary is read", () => {
  const stripped = stripEvidence(report);
  assert.doesNotMatch(stripped, /evidence:|npm test: 42/);
  assert.match(stripped, /needs_person: none\n```/);
  assert.equal(stripEvidence("plain"), "plain");
});

test("a row covers an older revision when the head moved or the criteria changed", () => {
  const row = { commitSha: "a", criteriaVersion: 1 };
  assert.equal(staleness(row, ["a"], 1), null);
  assert.equal(staleness(row, ["b"], 1), "commit");
  assert.equal(staleness(row, ["a"], 2), "criteria");
  assert.equal(staleness({ ...row, commitSha: null }, ["b"], 1), null, "a row without a commit is not dated by one");
  assert.equal(staleness(row, [null], 1), null, "unknown heads do not mark rows");
  assert.deepEqual(observedFor("test"), ["test", "ci", "merge"]);
});

test("criteria get stable ids", () => {
  assert.deepEqual(normalizeCriteria([{ text: " A " }, { id: "c1", text: "B", kind: "test" }, { text: "" }, { id: "c1", text: "C" }]),
    [{ id: "c2", text: "A", kind: "other" }, { id: "c1", text: "B", kind: "test" }, { id: "c3", text: "C", kind: "other" }]);
});
