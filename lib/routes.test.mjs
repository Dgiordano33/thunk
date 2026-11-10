import assert from "node:assert/strict";
import test from "node:test";
import { freshSlug, isProjectPath, newChatPath, pathsFor, projectPath, projectUrlSlug, sessionPath, workspacePath } from "./routes.ts";

const p = { slug: "thunk" };
const w = { slug: "fix-login" };

test("page paths nest workspace and session under the project", () => {
  assert.equal(projectPath(p), "/thunk");
  assert.equal(workspacePath(p, w), "/thunk/fix-login");
  assert.equal(newChatPath(p, w), "/thunk/fix-login/new");
  assert.equal(sessionPath(p, w, "abc"), "/thunk/fix-login/abc");
});

test("project slugs come from the name", () => {
  assert.equal(projectUrlSlug("Checkly Studio!"), "checkly-studio");
  assert.equal(projectUrlSlug("  --  "), "project");
  assert.equal(projectUrlSlug("x".repeat(60)).length, 48);
});

test("fresh slugs skip taken and reserved names", async () => {
  assert.equal(await freshSlug("thunk", () => false), "thunk");
  assert.equal(await freshSlug("thunk", (s) => s === "thunk"), "thunk-2");
  assert.equal(await freshSlug("inbox", () => false), "inbox-2");
  assert.equal(await freshSlug("projects", async (s) => s === "projects-2"), "projects-3");
});

test("project paths are anything outside the reserved top-level routes", () => {
  assert.equal(isProjectPath("/thunk"), true);
  assert.equal(isProjectPath("/thunk/main/new"), true);
  assert.equal(isProjectPath("/"), false);
  assert.equal(isProjectPath("/projects"), false);
  assert.equal(isProjectPath("/inbox"), false);
  assert.equal(isProjectPath("/w/123"), false);
});

test("pathsFor resolves ids to slug URLs and falls back to legacy id URLs", () => {
  const paths = pathsFor([{ id: "p1", slug: "thunk", workspaces: [{ id: "w1", slug: "main" }] }]);
  assert.equal(paths.project("p1"), "/thunk");
  assert.equal(paths.workspace("w1"), "/thunk/main");
  assert.equal(paths.session("w1", "s1"), "/thunk/main/s1");
  assert.equal(paths.project("p2"), "/p/p2");
  assert.equal(paths.session("w2", "s1"), "/w/w2/s/s1");
});
