import { test } from "node:test";
import assert from "node:assert/strict";
import { linearBranch, priorityFor, statusFor, syncLinearProject } from "./linear/sync.ts";
import { linearClient, LinearError } from "./linear/client.ts";

const issue = (over = {}) => ({ id: "i1", identifier: "ENG-1", title: "Fix login", description: "Steps", url: "https://linear.app/x/issue/ENG-1", priority: 2, updatedAt: "2026-11-22T10:00:00Z", state: { type: "unstarted" }, assignee: { isMe: true }, ...over });

function fakes({ open = [], byId = [] } = {}) {
  const tasks = new Map();
  let n = 0;
  const calls = { byIds: [] };
  const deps = {
    client: { myOpenIssues: async () => open, issuesByIds: async (ids) => { calls.byIds.push(ids); return byId.filter((i) => ids.includes(i.id)); } },
    listTasks: async () => [...tasks.values()],
    insertTask: async (input) => { const t = { id: `t${++n}`, workspaceId: null, sessionId: null, ...input }; tasks.set(t.id, t); return t; },
    updateTask: async (id, patch) => { const t = { ...tasks.get(id), ...patch }; tasks.set(id, t); return t; },
  };
  return { deps, tasks, calls, setOpen: (list) => { open.length = 0; open.push(...list); }, setById: (list) => { byId.length = 0; byId.push(...list); } };
}

test("state types and priorities map onto task statuses and priorities", () => {
  assert.deepEqual(["triage", "backlog", "unstarted", "started", "completed", "canceled"].map((type) => statusFor(issue({ state: { type } }))), ["open", "open", "open", "in_progress", "done", "cancelled"]);
  assert.deepEqual([0, 1, 2, 3, 4].map((priority) => priorityFor(issue({ priority }))), [0, 3, 3, 2, 1]);
});

test("open assigned issues are imported once, as integration tasks", async () => {
  const { deps, tasks } = fakes({ open: [issue()] });
  assert.deepEqual(await syncLinearProject(deps, "p1", "team"), { imported: 1, updated: 0, closed: 0 });
  assert.deepEqual(await syncLinearProject(deps, "p1", "team"), { imported: 0, updated: 0, closed: 0 });
  const [task] = tasks.values();
  assert.equal(task.createdBy, "integration");
  assert.equal(task.priority, 3);
  assert.deepEqual(task.external, { source: "linear", id: "i1", key: "ENG-1", url: "https://linear.app/x/issue/ENG-1", updatedAt: "2026-11-22T10:00:00Z" });
});

test("Linear wins only when the issue changed there: Thunk edits stay until then", async () => {
  const open = [issue()];
  const { deps, tasks, setOpen } = fakes({ open });
  await syncLinearProject(deps, "p1", "team");
  const [task] = tasks.values();
  await deps.updateTask(task.id, { status: "done", title: "My title" }); // edited in Thunk
  await syncLinearProject(deps, "p1", "team");
  assert.equal(tasks.get(task.id).status, "done", "an unchanged issue does not undo a Thunk edit");
  setOpen([issue({ title: "Fix login on Safari", state: { type: "started" }, updatedAt: "2026-11-22T11:00:00Z" })]);
  assert.equal((await syncLinearProject(deps, "p1", "team")).updated, 1);
  assert.equal(tasks.get(task.id).status, "in_progress");
  assert.equal(tasks.get(task.id).title, "Fix login on Safari");
});

test("issues completed, reassigned or deleted in Linear close their open tasks", async () => {
  const open = [issue(), issue({ id: "i2", identifier: "ENG-2" }), issue({ id: "i3", identifier: "ENG-3" })];
  const { deps, tasks, setOpen, setById } = fakes({ open });
  await syncLinearProject(deps, "p1", "team");
  setOpen([]);
  setById([
    issue({ state: { type: "completed" }, updatedAt: "2026-11-22T12:00:00Z" }),
    issue({ id: "i2", identifier: "ENG-2", assignee: { isMe: false }, updatedAt: "2026-11-22T12:00:00Z" }),
  ]);
  assert.equal((await syncLinearProject(deps, "p1", "team")).closed, 3);
  const status = Object.fromEntries([...tasks.values()].map((t) => [t.external.key, t.status]));
  assert.deepEqual(status, { "ENG-1": "done", "ENG-2": "cancelled", "ENG-3": "cancelled" });
  assert.equal((await syncLinearProject(deps, "p1", "team")).closed, 0, "closed tasks are not looked up again");
});

test("a task reopened in Linear and assigned back comes back open", async () => {
  const open = [issue()];
  const { deps, tasks, setOpen } = fakes({ open });
  await syncLinearProject(deps, "p1", "team");
  const [task] = tasks.values();
  await deps.updateTask(task.id, { status: "done" });
  setOpen([issue({ updatedAt: "2026-11-23T09:00:00Z" })]);
  await syncLinearProject(deps, "p1", "team");
  assert.equal(tasks.get(task.id).status, "open");
});

test("branches carry the issue key under thunk/", () => {
  assert.equal(linearBranch("ENG-123", "Fix the Login page!"), "thunk/eng-123-fix-the-login-page");
  assert.equal(linearBranch("ENG-9", "???"), "thunk/eng-9");
});

test("the client sends a personal key as-is and explains a rejected key", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push(init.headers.authorization); return new Response("{}", { status: 401 }); };
  await assert.rejects(linearClient("lin_api_x", fakeFetch).viewer(), (e) => e instanceof LinearError && /rejected the API key/.test(e.message));
  assert.deepEqual(seen, ["lin_api_x"]);
});
