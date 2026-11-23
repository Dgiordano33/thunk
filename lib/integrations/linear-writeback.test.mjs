import { test } from "node:test";
import assert from "node:assert/strict";
import { createLinearWriteBack, plan } from "./linear/writeback.ts";

const states = [
  { id: "s-backlog", type: "backlog", position: 0 }, { id: "s-todo", type: "unstarted", position: 1 },
  { id: "s-review", type: "started", position: 3 }, { id: "s-doing", type: "started", position: 2 },
  { id: "s-done", type: "completed", position: 4 }, { id: "s-cancel", type: "canceled", position: 5 },
];
const issue = (type, hasPullRequest = false) => ({ id: "i1", state: { type }, states, hasPullRequest });
const task = (status) => ({ id: "t1", status, external: { source: "linear", id: "i1", key: "ENG-1", url: "", updatedAt: null } });

test("starting a task moves an unstarted issue to the team's first started state", () => {
  assert.deepEqual(plan(issue("unstarted"), "in_progress"), { action: "started", stateId: "s-doing" });
  assert.deepEqual(plan(issue("backlog"), "in_progress"), { action: "started", stateId: "s-doing" });
  assert.equal(plan(issue("started"), "in_progress"), null, "already started");
  assert.equal(plan(issue("completed"), "in_progress"), null, "never reopens from Thunk");
});

test("finishing a task closes its issue unless a PR is attached or it is already closed", () => {
  assert.deepEqual(plan(issue("started"), "done"), { action: "completed", stateId: "s-done" });
  assert.equal(plan(issue("started", true), "done"), null, "Linear closes it when the PR merges");
  assert.equal(plan(issue("completed"), "done"), null, "the poller copied this from Linear");
  assert.equal(plan(issue("canceled"), "done"), null);
  assert.equal(plan(issue("started"), "cancelled"), null, "cancelling in Thunk leaves Linear alone");
});

function fake(state) {
  const calls = [];
  const client = { issueState: async () => { calls.push("read"); return issue(state); }, moveIssue: async (id, stateId) => { calls.push(`move ${stateId}`); } };
  return { calls, client };
}

test("the handler moves the issue once per status and skips when write-back is off", async () => {
  const { calls, client } = fake("unstarted");
  const wb = createLinearWriteBack({ client: async () => client, log: () => {} });
  assert.equal(await wb.handle(task("in_progress")), "started");
  assert.equal(await wb.handle(task("in_progress")), null);
  assert.deepEqual(calls, ["read", "move s-doing"]);
  const off = createLinearWriteBack({ client: async () => null, log: () => {} });
  assert.equal(await off.handle(task("done")), null);
});

test("a failed move is retried on the next change", async () => {
  let fail = true;
  const calls = [];
  const client = { issueState: async () => issue("started"), moveIssue: async () => { calls.push("move"); if (fail) throw new Error("down"); } };
  const wb = createLinearWriteBack({ client: async () => client, log: () => {} });
  await assert.rejects(wb.handle(task("done")));
  fail = false;
  assert.equal(await wb.handle(task("done")), "completed");
  assert.equal(calls.length, 2);
});

test("tasks without a Linear issue are ignored", async () => {
  const { calls, client } = fake("unstarted");
  const wb = createLinearWriteBack({ client: async () => client, log: () => {} });
  assert.equal(await wb.handle({ id: "t2", status: "done", external: null }), null);
  assert.equal(calls.length, 0);
});
