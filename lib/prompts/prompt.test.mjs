import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { fuzzyMatch, completionAt } from "./complete.ts";
import { ImagesSchema } from "./schema.ts";
import { promptContext, expandCommand } from "./context.ts";

test("fuzzy completion respects cursor and command position", () => {
  assert.equal(fuzzyMatch("components/chat/prompt-box.tsx", "chpb"), true);
  assert.equal(fuzzyMatch("prompt.ts", "zz"), false);
  assert.deepEqual(completionAt("look @comp later", 10), { start: 5, end: 10, kind: "@", query: "comp" });
  assert.equal(completionAt("look /command", 13), null);
  assert.equal(completionAt("/review", 7).query, "review");
});

test("images reject remote URLs, mismatched media types and excess files", () => {
  const image = { type: "file", mediaType: "image/png", url: "data:image/png;base64,aGVsbG8=" };
  assert.equal(ImagesSchema.safeParse([image]).success, true);
  assert.equal(ImagesSchema.safeParse([{ ...image, url: "https://example.com/a.png" }]).success, false);
  assert.equal(ImagesSchema.safeParse([{ ...image, mediaType: "image/jpeg" }]).success, false);
  assert.equal(ImagesSchema.safeParse(Array(6).fill(image)).success, false);
});

test("project commands expand arguments, list nested names, and exclude symlinks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "thunk-prompt-"));
  try {
    await mkdir(path.join(dir, ".claude/commands/review"), { recursive: true });
    await mkdir(path.join(dir, "node_modules"));
    await writeFile(path.join(dir, "node_modules/hidden.txt"), "hidden");
    await writeFile(path.join(dir, "app.ts"), "source");
    await writeFile(path.join(dir, ".claude/commands/review/code.md"), "---\ndescription: Review\n---\nReview $ARGUMENTS");
    await symlink(path.join(dir, "app.ts"), path.join(dir, ".claude/commands/escape.md"));
    const context = await promptContext(dir, dir);
    assert.deepEqual(context.commands, ["review:code"]);
    assert.deepEqual(context.files, ["app.ts"]);
    assert.equal(await expandCommand("/review:code this file", dir), "Review this file");
    await writeFile(path.join(dir, ".claude/commands/args.md"), "$1 then $2");
    assert.equal(await expandCommand('/args "two words" last', dir), "two words then last");
    assert.equal(await expandCommand("/unknown", dir), "/unknown");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("messages wait through running and awaiting states, then drain FIFO with images", async () => {
  // Load the registry with inert drivers so this check never starts an agent process.
  const source = await readFile(new URL("../agent/session-registry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(() => ({}), exports);
  const sent = [];
  const live = { ctx: { project: { kind: "folder" } }, id: "test", meta: { status: "running", title: "Test" }, driver: { isClosed: false, send: (...args) => sent.push(args) }, events: [], seq: 0, subscribers: new Set(), queuedMessages: [] };
  const images = [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,aGVsbG8=" }];
  const first = exports.pushUserMessage(live, "first", { images });
  live.meta.status = "awaiting";
  exports.pushUserMessage(live, "second");
  assert.equal(sent.length, 0);
  exports.setState(live, "idle");
  assert.deepEqual(sent, [["first", images]]);
  assert.equal(live.meta.status, "running");
  assert.equal(live.events.find((e) => e.type === "message_dequeued").messageId, first);
  exports.setState(live, "idle");
  assert.deepEqual(sent[1], ["second", []]);
  exports.setState(live, "idle");
  assert.equal(live.meta.status, "idle");
});


test("resuming replays only messages still queued", async () => {
  const source = await readFile(new URL("../agent/session-registry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const sent = [];
  const driver = { run: () => new Promise(() => {}), send: (...args) => sent.push(args), close() {} };
  new Function("require", "exports", compiled)(() => ({
    providerOf: () => "claude", createClaudeDriver: async () => driver, expandCommand: async (text) => text,
  }), exports);
  const live = await exports.createSession({
    id: "resume-test", model: "claude", permissionMode: "default", resume: "sdk-id",
    ctx: { project: { id: "p", root: "/tmp" }, workspace: { id: "w", cwd: "/tmp" } },
    seqStart: 3,
    events: [
      { type: "user_message", messageId: "sent", content: "sent", queued: true },
      { type: "message_dequeued", messageId: "sent" },
      { type: "user_message", messageId: "waiting", content: "waiting", queued: true, kind: "prompt" },
    ],
  });
  assert.deepEqual(sent, [["waiting", []]]);
  assert.equal(live.meta.status, "running");
  exports.closeSession(live.id);
});

test("repo prompts snapshot before dispatch, including queued prompts, and warn without blocking on snapshot errors", async () => {
  const source = await readFile(new URL("../agent/session-registry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  let release;
  let fail = false;
  let snapshots = 0;
  let lockHeld = null;
  const sent = [];
  new Function("require", "exports", compiled)(() => ({
    withWorkspaceLock: (_cwd, fn, opts) => {
      if (!lockHeld) return fn();
      if (!opts?.wait) throw new Error("A workspace operation is already running");
      return lockHeld.then(fn);
    },
    captureCheckpoint: async () => {
      snapshots++;
      if (fail) throw new Error("conflicts");
      await new Promise((resolve) => { release = resolve; });
    },
  }), exports);
  const live = { ctx: { project: { kind: "repo" }, workspace: { cwd: "/tmp", id: "w" } }, id: "test", meta: { status: "idle", title: "Test" }, driver: { isClosed: false, send: (...args) => sent.push(args) }, events: [], seq: 0, subscribers: new Set(), queuedMessages: [] };
  exports.pushUserMessage(live, "first");
  assert.equal(live.meta.status, "running");
  assert.equal(sent.length, 0);
  exports.pushUserMessage(live, "second");
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[0][0], "first");
  exports.setState(live, "idle");
  assert.equal(snapshots, 2);
  assert.equal(sent.length, 1);
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[1][0], "second");
  exports.setState(live, "idle"); fail = true;
  exports.pushUserMessage(live, "resolve conflicts");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[2][0], "resolve conflicts");
  assert.ok(live.events.some((e) => e.type === "error" && e.message.includes("without rewind")));
  exports.setState(live, "idle");
  let unlock;
  lockHeld = new Promise((resolve) => { unlock = resolve; });
  exports.pushUserMessage(live, "must wait for rewind");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 3);
  assert.equal(live.meta.status, "running");
  unlock(); lockHeld = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[3][0], "must wait for rewind");
});
