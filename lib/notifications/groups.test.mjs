import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_GROUPS, NOTIFICATION_KINDS } from "./types.ts";

test("every notification kind is in exactly one Settings group", () => {
  const grouped = NOTIFICATION_GROUPS.flatMap((g) => g.kinds);
  assert.deepEqual([...grouped].sort(), [...NOTIFICATION_KINDS].sort());
});
