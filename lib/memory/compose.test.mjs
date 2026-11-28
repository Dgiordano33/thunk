import { test } from "node:test";
import assert from "node:assert/strict";
import { addedTexts, composeMemory } from "./compose.ts";

const memory = "# Project memory\n\n- Use pnpm.\n- Tests live in tests/.\n";

test("add appends under the last bullet, replace and remove act on the exact target", () => {
  const { content, outcomes } = composeMemory(memory, [
    { id: "a", op: "add", target: null, text: "- Migrations apply on startup." },
    { id: "r", op: "replace", target: "- Use pnpm.", text: "- Use npm; pnpm was dropped." },
    { id: "x", op: "remove", target: "- Tests live in tests/." },
  ]);
  assert.equal(content, "# Project memory\n\n- Use npm; pnpm was dropped.\n- Migrations apply on startup.\n");
  assert.ok(outcomes.every((o) => o.applied));
});

test("missing, repeated and already-present targets are flagged and skipped", () => {
  const twice = `${memory}- Use pnpm.\n`;
  const { content, outcomes } = composeMemory(twice, [
    { id: "gone", op: "remove", target: "- Use yarn." },
    { id: "twice", op: "replace", target: "- Use pnpm.", text: "- Use npm." },
    { id: "dup", op: "add", target: null, text: "- Tests live in tests/." },
  ]);
  assert.equal(content, twice);
  assert.deepEqual(outcomes.map((o) => o.flag), ["No longer in memory", "Appears more than once in memory", "Already in memory"]);
});

test("a paragraph after prose gets a blank line, and addedTexts lists only what landed", () => {
  const items = [{ id: "p", op: "add", target: null, text: "Deploys pull every minute." }, { id: "n", op: "remove", target: "nope" }];
  const { content, outcomes } = composeMemory("Intro.", items);
  assert.equal(content, "Intro.\n\nDeploys pull every minute.\n");
  assert.deepEqual(addedTexts(items, outcomes), ["Deploys pull every minute."]);
});
