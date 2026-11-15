import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLink } from "./link.ts";

test("web, mail and relative links are kept; bare domains get https", () => {
  assert.deepEqual(normalizeLink(" https://checklyhq.com/docs "), { href: "https://checklyhq.com/docs" });
  assert.deepEqual(normalizeLink("http://localhost:3000"), { href: "http://localhost:3000" });
  assert.deepEqual(normalizeLink("mailto:team@example.com"), { href: "mailto:team@example.com" });
  assert.deepEqual(normalizeLink("/notes/plan"), { href: "/notes/plan" });
  assert.deepEqual(normalizeLink("#results"), { href: "#results" });
  assert.deepEqual(normalizeLink("example.com/a?b=1"), { href: "https://example.com/a?b=1" });
  assert.deepEqual(normalizeLink("localhost:3000/x"), { href: "https://localhost:3000/x" });
});

test("an empty link removes it; other schemes and spaces are refused", () => {
  assert.deepEqual(normalizeLink("   "), { remove: true });
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "file:///etc/passwd"]) assert.ok("error" in normalizeLink(bad), bad);
  assert.ok("error" in normalizeLink("two words"));
});
