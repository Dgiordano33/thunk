import { test } from "node:test";
import assert from "node:assert/strict";
import { diffHunks, buildReview } from "./diff.ts";

test("review anchors keep exact hunks and file paths in the agent payload", () => {
  const diff = "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n@@ -9 +9 @@\n-next\n+last\n";
  const hunks = diffHunks(diff);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0], "@@ -1 +1 @@\n-old\n+new");
  assert.equal(hunks[1], "@@ -9 +9 @@\n-next\n+last\n");
  assert.deepEqual(diffHunks("Binary files differ"), []);
  const payload = buildReview([{ id: "1", path: 'a weird "file".ts', hunk: hunks[0], body: "Handle errors" }]);
  assert.ok(payload.includes(JSON.stringify('a weird "file".ts')));
  assert.ok(payload.includes(hunks[0]));
  assert.ok(payload.includes("Handle errors"));
});
