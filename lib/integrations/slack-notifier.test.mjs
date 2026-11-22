import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlackNotifier, slackMessage } from "./slack/notifier.ts";
import { slackClient, SlackError } from "./slack/client.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = { id: "n1", kind: "permission", urgency: "action", projectId: "p1", workspaceId: null, sessionId: null, runId: null, subjectKey: "s", title: "Approve <rm -rf>", detail: "Bash & friends", href: "/thunk/main/abc", actions: [], status: "open", readAt: null, resolvedAt: null, createdAt: "", updatedAt: "" };

function setup({ row = base, kinds = ["permission"], settings = { botToken: "xoxb-1", userId: "U1" }, failPost = false } = {}) {
  const rows = new Map([[row.id, { ...row }]]);
  const refs = new Map();
  const calls = [];
  const logs = [];
  const client = {
    authTest: async () => ({ team: "T", user: "thunk" }),
    openDm: async (user) => { calls.push(["openDm", user]); return "D1"; },
    post: async (channel, message) => { calls.push(["post", channel, message]); if (failPost) throw new Error("boom"); return { channel, ts: "1.0" }; },
    update: async (channel, ts, message) => { calls.push(["update", channel, ts, message]); },
  };
  const notifier = createSlackNotifier({
    settings: async () => settings, kinds: async () => kinds, client: () => client,
    getNotification: async (id) => rows.get(id) ?? null, projectName: async () => "Thunk",
    publicUrl: () => "https://thunk.example.ts.net", saveRef: async (id, ref) => { refs.set(id, ref); }, getRef: async (id) => refs.get(id) ?? null,
    delayMs: 10, log: (m) => logs.push(m),
  });
  return { notifier, rows, refs, calls, logs };
}

test("an unread notification is DMed after the delay, with a link to Thunk", async () => {
  const { notifier, calls, refs } = setup();
  notifier.handle({ kind: "opened", notification: base });
  assert.equal(calls.length, 0, "nothing before the delay");
  await sleep(30);
  assert.deepEqual(calls.map((c) => c[0]), ["openDm", "post"]);
  const blocks = JSON.stringify(calls[1][2].blocks);
  assert.match(blocks, /https:\/\/thunk.example.ts.net\/thunk\/main\/abc/);
  assert.match(blocks, /Approve &lt;rm -rf&gt;/);
  assert.deepEqual(refs.get("n1"), { channel: "D1", ts: "1.0" });
});

test("nothing is sent when the notification is read or resolved within the delay", async () => {
  const { notifier, rows, calls } = setup();
  notifier.handle({ kind: "opened", notification: base });
  const read = { ...base, readAt: "now" };
  rows.set("n1", read);
  notifier.handle({ kind: "updated", notification: read });
  assert.equal(notifier.pendingCount(), 0);
  await sleep(30);
  assert.equal(calls.length, 0);
});

test("a notification read by the time the delay ends is skipped even without an update event", async () => {
  const { notifier, rows, calls } = setup();
  notifier.handle({ kind: "opened", notification: base });
  rows.set("n1", { ...base, status: "resolved" });
  await sleep(30);
  assert.equal(calls.length, 0);
});

test("kinds not chosen for Slack, and Slack turned off, send nothing", async () => {
  for (const options of [{ kinds: ["question"] }, { settings: null }]) {
    const { notifier, calls } = setup(options);
    notifier.handle({ kind: "opened", notification: base });
    await sleep(30);
    assert.equal(calls.length, 0);
  }
});

test("resolving a sent notification crosses out the DM once and drops its button", async () => {
  const { notifier, rows, calls } = setup();
  notifier.handle({ kind: "opened", notification: base });
  await sleep(30);
  const resolved = { ...base, status: "resolved" };
  rows.set("n1", resolved);
  notifier.handle({ kind: "updated", notification: resolved });
  notifier.handle({ kind: "updated", notification: resolved });
  await sleep(10);
  const updates = calls.filter((c) => c[0] === "update");
  assert.equal(updates.length, 1);
  const blocks = JSON.stringify(updates[0][3].blocks);
  assert.match(blocks, /~Approve/);
  assert.match(blocks, /Resolved in Thunk/);
  assert.doesNotMatch(blocks, /Open in Thunk/);
});

test("a failed post is logged and does not throw", async () => {
  const { notifier, logs } = setup({ failPost: true });
  notifier.handle({ kind: "opened", notification: base });
  await sleep(30);
  assert.equal(logs.length, 1);
});

test("slackMessage keeps long details short", () => {
  const message = slackMessage({ ...base, detail: "x".repeat(2000) }, null, "https://x");
  assert.ok(JSON.stringify(message.blocks).length < 1200);
});

test("the client sends a bearer token and turns Slack errors into readable messages", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push([url, init.headers.authorization]); return new Response(JSON.stringify({ ok: false, error: "invalid_auth" })); };
  await assert.rejects(slackClient("xoxb-9", fakeFetch).authTest(), (e) => e instanceof SlackError && /Bot User OAuth Token/.test(e.message));
  assert.deepEqual(seen[0], ["https://slack.com/api/auth.test", "Bearer xoxb-9"]);
});
