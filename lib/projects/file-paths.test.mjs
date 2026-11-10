import assert from "node:assert/strict";
import test from "node:test";
import { cleanRelativePath, fileName, isWithin } from "./file-paths.ts";

test("relative paths are normalised", () => {
  assert.equal(cleanRelativePath(""), "");
  assert.equal(cleanRelativePath("src//app/./page.tsx"), "src/app/page.tsx");
  assert.equal(cleanRelativePath("src/"), "src");
  assert.equal(cleanRelativePath(".github/workflows/ci.yml"), ".github/workflows/ci.yml");
});

test("paths that could escape the root or touch .git are rejected", () => {
  assert.equal(cleanRelativePath("../etc/passwd"), null);
  assert.equal(cleanRelativePath("src/../../x"), null);
  assert.equal(cleanRelativePath("/etc/passwd"), null);
  assert.equal(cleanRelativePath("C:/Windows"), null);
  assert.equal(cleanRelativePath("a\\..\\b"), null);
  assert.equal(cleanRelativePath(".git/config"), null);
  assert.equal(cleanRelativePath("sub/.git/HEAD"), null);
  assert.equal(cleanRelativePath("a\0b"), null);
});

test("containment checks whole segments", () => {
  assert.ok(isWithin("/repo", "/repo"));
  assert.ok(isWithin("/repo", "/repo/a/b"));
  assert.ok(!isWithin("/repo", "/repo-other/a"));
  assert.ok(!isWithin("/repo", "/"));
});

test("file names are the last segment", () => {
  assert.equal(fileName("src/app/page.tsx"), "page.tsx");
  assert.equal(fileName("README.md"), "README.md");
});
