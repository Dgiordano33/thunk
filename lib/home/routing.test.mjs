import assert from "node:assert/strict";
import test from "node:test";
import { markLine, openItems, parseRoutingItems, updateMark } from "./routing.ts";

const targets = [
  { projectId: "p1", name: "Thunk", slug: "thunk", workspaces: [{ id: "w1", slug: "onboarding", name: "onboarding" }] },
  { projectId: "p2", name: "Marketing Site", slug: "marketing", workspaces: [] },
];

test("tags route an item; a workspace tag pins the workspace", () => {
  const items = parseRoutingItems("- [ ] fix login #thunk\n- [ ] copy pass #thunk/onboarding\n- [ ] something else", targets);
  assert.deepEqual(items.map((i) => i.target), [
    { projectId: "p1", workspaceId: null, via: "tag" },
    { projectId: "p1", workspaceId: "w1", via: "tag" },
    null,
  ]);
});

test("headings scope the items under them; tags win; unknown headings end the scope", () => {
  const md = "## Marketing site\n- [ ] new hero\n- [ ] bug #thunk\n## Misc\n- [ ] ???";
  const items = parseRoutingItems(md, targets);
  assert.equal(items[0].target.projectId, "p2");
  assert.equal(items[0].target.via, "heading");
  assert.equal(items[1].target.projectId, "p1");
  assert.equal(items[2].target, null);
});

test("unknown tags are reported, checked and fenced items are handled", () => {
  const md = "- [ ] x #nope\n- [x] done #thunk\n```\n- [ ] in code #thunk\n```";
  const items = parseRoutingItems(md, targets);
  assert.equal(items.length, 2);
  assert.equal(items[0].unknownTag, "#nope");
  assert.equal(items[1].done, true);
  assert.equal(openItems(items).length, 1);
});

test("marks are written, recognised, updated after the line moves, and check the box", () => {
  let md = "- [ ] fix login #thunk";
  md = markLine(md, 0, "abcd1234", "Thunk: routed");
  assert.equal(md, "- [ ] fix login #thunk → Thunk: routed (r:abcd1234)");
  const [item] = parseRoutingItems(md, targets);
  assert.equal(item.routed, "abcd1234");
  assert.equal(item.text, "fix login #thunk");
  assert.equal(openItems([item]).length, 0);
  md = `# Plans\n\n${md}`;
  md = updateMark(md, "abcd1234", "Thunk: done", true);
  assert.equal(md.split("\n")[2], "- [x] fix login #thunk → Thunk: done (r:abcd1234)");
  assert.equal(updateMark(md, "ffffffff", "x"), null);
  assert.equal(markLine("plain line", 0, "abcd1234", "x"), null);
});
