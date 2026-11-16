import assert from "node:assert/strict";
import test from "node:test";
import { filePagePath, filePathFromUrl, projectSectionPath, projectSlugFromPath, canvasPath, RESERVED_WORKSPACE_SLUGS, freshSlug, isProjectPath, newChatPath, pathsFor, projectPath, projectUrlSlug, sessionPath, workspacePath } from "./routes.ts";

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

test("Canvas has a reserved project route", () => { assert.equal(canvasPath(p), "/thunk/canvas"); assert.equal(canvasPath(p, "main"), "/thunk/canvas"); assert.equal(canvasPath(p, "research"), "/thunk/canvas?session=research"); assert.ok(RESERVED_WORKSPACE_SLUGS.includes("canvas")); });

test("file URLs preserve nested paths and encode filename characters exactly once", () => {
  const base = "/thunk/main";
  for (const path of ["src/app/page.tsx", "notes/a #?% ü.md", "literal%2F.txt"]) {
    const url = new URL(filePagePath(base, "repo one", path, "changes"), "https://thunk.test");
    assert.equal(filePathFromUrl(base, url.pathname), path);
    assert.equal(url.searchParams.get("root"), "repo one");
    assert.equal(url.searchParams.get("tab"), "changes");
    assert.equal(url.searchParams.has("path"), false);
  }
  assert.equal(filePagePath(base, null, "src/app.ts"), "/thunk/main/file/src/app.ts");
  assert.equal(filePathFromUrl(base, "/thunk/main/new"), null);
  assert.equal(filePathFromUrl(base, "/thunk/main/file/%xx"), null);
});

test("project screens have distinct URLs and preserve legacy id fallbacks", () => {
  for (const [building, section] of Object.entries({ center: "settings", library: "notes", tasks: "tasks", workshop: "routines", vault: "vault" })) {
    const path = projectSectionPath("/thunk", building);
    assert.equal(path, `/projects/thunk/${section}`);
    assert.equal(isProjectPath(path), true);
    assert.equal(projectSlugFromPath(path), "thunk");
  }
  assert.equal(projectSlugFromPath("/thunk/main/new"), "thunk");
  assert.equal(projectSlugFromPath("/projects"), null);
  assert.equal(projectSectionPath("/thunk", "library", { note: "a b" }), "/projects/thunk/notes?note=a+b");
  const legacy = new URL(projectSectionPath("/p/123", "workshop", { routine: "abc" }), "https://thunk.test");
  assert.equal(legacy.pathname, "/p/123");
  assert.equal(legacy.searchParams.get("building"), "workshop");
  assert.equal(legacy.searchParams.get("routine"), "abc");
});
