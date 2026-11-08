/* eslint-disable @typescript-eslint/no-require-imports -- The compiler hook exercises server TypeScript through Node’s CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
const projects = new Map();
const mocks = {
  "@/lib/env": { env: { DEFAULT_MODEL: "test-model" } },
  "@/lib/supabase/repo/projects": { getProject: async (id) => projects.get(id) ?? null, listProjects: async () => [...projects.values()] },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  if (mocks[request]) return mocks[request];
  return load.call(this, request, ...rest);
};

const store = require("../lib/vault/store.ts");
const types = require("../lib/vault/types.ts");
const office = require("../lib/vault/office.ts");
const extract = require("../lib/vault/extract.ts");
const tools = require("../lib/vault/tools.ts");

async function vault(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "thunk-vault-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { projectId: "p1", dir: path.join(base, "vault") };
}

/** A minimal zip with deflated entries, enough to stand in for an OOXML file. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const reply = { title: "Onboarding research", summary: "## What\n\nFive interviews.", ideas: [{ title: "Shorten signup", detail: "Three fields drop off.", kind: "action" }, { title: "Why do teams churn?", detail: "", kind: "question" }], tags: ["Research", "onboarding", "research"] };

test("classify uses the extension before a missing or generic MIME", () => {
  assert.deepEqual(types.classify("shot.PNG", ""), { kind: "image", mime: "image/png" });
  assert.equal(types.classify("spec.pdf", "application/octet-stream").kind, "pdf");
  assert.equal(types.classify("notes.md", "").kind, "text");
  assert.equal(types.classify("deck.pptx", "").kind, "office");
  assert.equal(types.classify("call.vtt", "").mime, "text/plain");
  assert.equal(types.classify("blob.bin", "application/octet-stream").kind, "other");
  assert.equal(types.classify("page", "text/html").kind, "text");
});

test("store round trip: create, list, update, read original, delete", async (t) => {
  const v = await vault(t);
  const a = await store.createItem(v, { filename: "../../etc/Customer_interviews.md", mime: "text/markdown", bytes: Buffer.from("# Hi") });
  assert.match(a.id, /^[a-z0-9]{10}$/);
  assert.equal(a.filename, "Customer_interviews.md", "directory parts are stripped");
  assert.equal(a.title, "Customer interviews");
  assert.equal(a.status, "queued");
  assert.equal(a.path, path.join(v.dir, a.id, "original.md"));
  assert.equal((await store.readOriginal(v, a)).toString(), "# Hi");
  const b = await store.createItem(v, { filename: "x.png", mime: "image/png", bytes: Buffer.from([1, 2]), title: "Mine" });
  assert.equal(b.titled, true);
  assert.equal((await store.listItems(v)).length, 2);
  const failed = await store.updateItem(v, a.id, { status: "failed", error: "nope" });
  assert.equal(failed.error, "nope");
  const ready = await store.updateItem(v, a.id, { status: "ready" });
  assert.equal(ready.error, undefined, "error clears once it isn't failed");
  assert.equal(JSON.parse(await fs.readFile(path.join(v.dir, a.id, "item.json"), "utf8")).path, undefined, "path isn't persisted");
  assert.equal(await store.updateItem(v, "zzzzzzzzzz", { title: "x" }), null);
  await store.deleteItem(v, a.id);
  assert.deepEqual((await store.listItems(v)).map((i) => i.id), [b.id]);
  assert.throws(() => store.originalPath(v, { id: "../evil", filename: "a" }), /Invalid/);
});

test("concurrent updates to one item don't clobber each other", async (t) => {
  const v = await vault(t);
  const a = await store.createItem(v, { filename: "a.txt", mime: "text/plain", bytes: Buffer.from("x") });
  await Promise.all([
    store.updateItem(v, a.id, (cur) => ({ promoted: [...(cur.promoted ?? []), { ideaId: "1", noteId: "n" }] })),
    store.updateItem(v, a.id, (cur) => ({ promoted: [...(cur.promoted ?? []), { ideaId: "2", taskId: "t" }] })),
  ]);
  assert.equal((await store.readItem(v, a.id)).promoted.length, 2);
});

test("office text: docx paragraphs, pptx slides, xlsx shared strings", () => {
  const docx = zip({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t><w:tab/><w:t>col</w:t></w:r></w:p></w:body></w:document>" });
  assert.equal(office.officeText(docx, "docx"), "Hello & welcome\nSecond\tcol");
  const pptx = zip({ "ppt/slides/slide2.xml": "<p:sld><a:p><a:t>Two</a:t></a:p></p:sld>", "ppt/slides/slide10.xml": "<a:p><a:t>Ten</a:t></a:p>", "ppt/slides/slide1.xml": "<a:p><a:t>One</a:t></a:p>" });
  assert.equal(office.officeText(pptx, "pptx"), "## Slide 1\n\nOne\n\n## Slide 2\n\nTwo\n\n## Slide 3\n\nTen");
  const xlsx = zip({
    "xl/sharedStrings.xml": "<sst><si><t>Name</t></si><si><t>Ada &lt;3</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row><row><c r="A2" t="s"><v>1</v></c></row></sheetData>',
  });
  assert.equal(office.officeText(xlsx, "xlsx"), "## Sheet 1\n\nName\t42\nAda <3");
  assert.throws(() => office.officeText(Buffer.from("not a zip at all, definitely not"), "docx"), /zip/);
});

test("buildContent shapes each kind into content blocks", () => {
  const img = extract.buildContent({ filename: "a.png", mime: "image/png", kind: "image", title: "a" }, Buffer.from([1, 2, 3]));
  assert.deepEqual(img[0], { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } });
  assert.equal(img[1].type, "text");
  const pdf = extract.buildContent({ filename: "a.pdf", mime: "application/pdf", kind: "pdf", title: "a" }, Buffer.from("%PDF"));
  assert.equal(pdf[0].type, "document");
  assert.equal(pdf[0].source.media_type, "application/pdf");
  const big = "x".repeat(extract.MAX_TEXT_CHARS + 10);
  const text = extract.buildContent({ filename: "a.txt", mime: "text/plain", kind: "text", title: "a" }, Buffer.from(big));
  assert.equal(text[0].source.type, "text");
  assert.match(text[0].source.data, /truncated: 10 more characters/);
  assert.throws(() => extract.buildContent({ filename: "a.txt", mime: "text/plain", kind: "text", title: "a" }, Buffer.from("  \n")), /empty/);
  assert.throws(() => extract.buildContent({ filename: "a.bin", mime: "application/zip", kind: "other", title: "a" }, Buffer.from("x")), extract.UnsupportedError);
  const doc = extract.buildContent({ filename: "a.docx", mime: "x", kind: "office", title: "a" }, zip({ "word/document.xml": "<w:p><w:t>Body</w:t></w:p>" }));
  assert.equal(doc[0].source.data, "Body");
});

test("parseExtraction accepts structured output, fenced JSON and prose-wrapped JSON", () => {
  const a = extract.parseExtraction(reply);
  assert.equal(a.ideas.length, 2);
  assert.match(a.ideas[0].id, /^[a-z0-9]{6}$/);
  assert.deepEqual(a.tags, ["research", "onboarding"], "tags lowercased and deduped");
  assert.equal(extract.parseExtraction("```json\n" + JSON.stringify(reply) + "\n```").title, "Onboarding research");
  assert.equal(extract.parseExtraction("Sure! " + JSON.stringify(reply) + " Hope that helps").title, "Onboarding research");
  assert.equal(extract.parseExtraction({ ...reply, ideas: [{ title: "x", kind: "nonsense" }] }).ideas[0].kind, "idea");
  assert.throws(() => extract.parseExtraction("no json here"), /valid JSON/);
  assert.throws(() => extract.parseExtraction({ title: "", summary: "s" }), /expected shape/);
});

test("processItem: queued → ready with ideas; keeps a user title; failures are recorded", async (t) => {
  const v = await vault(t);
  const a = await store.createItem(v, { filename: "interviews.md", mime: "text/markdown", bytes: Buffer.from("# Notes\nlots") });
  let seen;
  const ready = await extract.processItem(v, a.id, async (content) => {
    seen = content;
    assert.equal((await store.readItem(v, a.id)).status, "processing");
    return reply;
  });
  assert.equal(seen[0].source.data, "# Notes\nlots");
  assert.equal(ready.status, "ready");
  assert.equal(ready.title, "Onboarding research");
  assert.equal(ready.ideas.length, 2);

  const b = await store.createItem(v, { filename: "x.md", mime: "text/markdown", bytes: Buffer.from("x"), title: "My title" });
  assert.equal((await extract.processItem(v, b.id, async () => reply)).title, "My title");

  const c = await store.createItem(v, { filename: "x.md", mime: "text/markdown", bytes: Buffer.from("x") });
  const failed = await extract.processItem(v, c.id, async () => { throw new Error("rate limited"); });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "rate limited");

  const d = await store.createItem(v, { filename: "x.zip", mime: "application/zip", bytes: Buffer.from("x") });
  let ran = false;
  const unsupported = await extract.processItem(v, d.id, async () => { ran = true; return reply; });
  assert.equal(unsupported.status, "failed");
  assert.equal(ran, false, "unsupported files never reach Claude");
  assert.equal(await extract.processItem(v, "zzzzzzzzzz", async () => reply), null);
});

test("vault tools list, filter and read items for the session's project only", async (t) => {
  const v = await vault(t);
  projects.set("p1", { id: "p1", root: "/unused" });
  // Point the project's vault at the temp dir (tools read it through vaultDirOf).
  const dirModule = require("../lib/vault/dir.ts");
  const real = dirModule.vaultDirOf;
  dirModule.vaultDirOf = (p) => ({ projectId: p.id, dir: v.dir });
  t.after(() => { dirModule.vaultDirOf = real; });

  const a = await store.createItem(v, { filename: "interviews.md", mime: "text/markdown", bytes: Buffer.from("x") });
  await extract.processItem(v, a.id, async () => reply);
  await store.updateItem(v, a.id, (cur) => ({ promoted: [{ ideaId: cur.ideas[0].id, noteId: "abc123" }] }));
  const item = await store.readItem(v, a.id);

  assert.match(tools.listLine(item), new RegExp(`^${a.id} · Text · ready · Onboarding research · 2 ideas · #research #onboarding — What`));
  const text = tools.readText(item);
  assert.match(text, /Original file \(read it with your file tools\): .*original\.md/);
  assert.match(text, /\[Action\] \*\*Shorten signup\*\* — Three fields drop off\. \(sent to note abc123\)/);
  assert.match(tools.vaultPrompt([item], v.dir), /vault_list/);
  assert.match(tools.vaultPrompt([], v.dir), /The Vault is empty/);

  const run = (name, args, projectId = "p1") => tools.vaultTools({ projectId }).find((x) => x.name === name).handler(args);
  assert.match((await run("vault_list", {})).content[0].text, /Onboarding research/);
  assert.match((await run("vault_list", { query: "ONBOARD" })).content[0].text, /Onboarding research/);
  assert.equal((await run("vault_list", { query: "zebra" })).content[0].text, "No vault items match.");
  assert.match((await run("vault_read", { id: a.id })).content[0].text, /## Ideas/);
  assert.equal((await run("vault_read", { id: "zzzzzzzzzz" })).isError, true);
  assert.equal((await run("vault_list", { extra: 1 })).isError, true, "unknown args are rejected");
  const set = tools.vaultTools({ projectId: "missing" });
  const res = await set.find((x) => x.name === "vault_list").handler({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Project not found/);
  const bad = await tools.vaultTools({ projectId: "p1" }).find((x) => x.name === "vault_read").handler({ id: "../../x" });
  assert.equal(bad.isError, true);
  assert.deepEqual(tools.VAULT_TOOL_NAMES, ["vault_list", "vault_read"]);
});
