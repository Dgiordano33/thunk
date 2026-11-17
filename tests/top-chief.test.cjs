/* eslint-disable @typescript-eslint/no-require-imports -- Server TypeScript compiler harness. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-top-chief-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const id = () => crypto.randomUUID();

const thunk = { id: id(), dataKey: "thunk", slug: "thunk", name: "Thunk", repos: [], repoFolders: [] };
const site = { id: id(), dataKey: "site", slug: "marketing", name: "Marketing Site", repos: [], repoFolders: [] };
const onboarding = { id: id(), projectId: thunk.id, slug: "onboarding", name: "onboarding", status: "active", branch: "thunk/onboarding" };
let home = null;
const workspaces = new Map();
const sessions = new Map();
const notes = new Map();
const notifications = [];
const resolved = [];
const logs = [];
const emit = (live, event) => { live.events.push({ ...event, seq: ++live.seq }); };
const newLive = (input, project) => {
  const live = { id: id(), meta: { ...input, projectId: project.id, status: "idle", createdAt: new Date(Date.now() + sessions.size).toISOString() }, ctx: { project, workspace: { slug: "main" } }, events: [], seq: 0 };
  sessions.set(live.id, live);
  return live;
};
const chiefs = new Map();
const mocks = {
  "server-only": {},
  "@/lib/agent": {
    getSession: (sid) => sessions.get(sid),
    listSessions: async ({ workspaceId }) => [...sessions.values()].filter((s) => s.meta.workspaceId === workspaceId).map((s) => ({ ...s.meta, id: s.id })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    resumeSession: async (sid) => sessions.get(sid) ?? null,
    pushUserMessage: (live, content) => emit(live, { type: "user_message", content }),
  },
  "@/lib/projects": { ensureMainWorkspace: async (p) => { const ws = workspaces.get(p.id) ?? { id: id(), projectId: p.id, slug: "main" }; workspaces.set(p.id, ws); return ws; } },
  "@/lib/projects/paths": { projectConfigDir: (key) => path.join(tmp, key, "config"), projectMemoryFile: (key) => path.join(tmp, key, "MEMORY.md") },
  "@/lib/notes/resolve": { projectNoteDirs: (p) => ({ notesDir: p.dataKey }) },
  "@/lib/notes/store": {
    readNote: async (dirs, nid) => notes.get(`${dirs.notesDir}/${nid}`) ?? null,
    listNotes: async (dirs) => [...notes.values()].filter((n) => n.path.startsWith(`${dirs.notesDir}/`)),
    writeNote: async (dirs, nid, patch) => { const note = notes.get(`${dirs.notesDir}/${nid}`); assert.equal(patch.expectedUpdatedAt, note.updatedAt); Object.assign(note, patch, { updatedAt: id() }); return note; },
  },
  "@/lib/notifications/service": { notify: async (n) => notifications.push(n), resolveBySubject: async (s) => { resolved.push(s); return []; } },
  "@/lib/routes": { sessionPath: () => "/__home/main/s" },
  "@/lib/supabase/repo/projects": {
    getProject: async (pid) => [thunk, site, home].find((p) => p?.id === pid) ?? null,
    getProjectByKey: async (key) => home?.dataKey === key ? home : null,
    upsertProjectByKey: async (input) => (home ??= { id: id(), ...input, repos: [], repoFolders: [] }),
    listProjects: async () => [thunk, site],
  },
  "@/lib/supabase/repo/workspaces": { listWorkspaces: async (pid) => pid === thunk.id ? [onboarding] : [] },
  "@/lib/supabase/repo/tasks": { listTasks: async () => [] },
  "@/lib/workers/start": { startWorkerSession: async (input) => newLive(input, home) },
  "@/lib/workers/log": { appendWorkLog: async (p, entry) => { logs.push([p.name, entry]); return { path: `${p.dataKey}/work-log` }; } },
  "@/lib/workers/service": { openChief: async (pid) => { const project = [thunk, site].find((p) => p.id === pid); if (!chiefs.has(pid)) chiefs.set(pid, newLive({ workspaceId: id(), origin: { kind: "chief" } }, project)); return chiefs.get(pid); } },
};
const cache = new Map();
function load(name, from = path.join(root, "index.ts")) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
  let filename = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(from), name);
  if (!filename.endsWith(".ts")) filename += ".ts";
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  mod.require = (request) => load(request, filename);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const service = load("@/lib/home/service");
const triage = load("@/lib/home/triage");
const prompt = load("@/lib/workers/prompt");
const messages = (live) => live.events.filter((e) => e.type === "user_message").map((e) => e.content);
const addNote = (nid, markdown) => notes.set(`__home/${nid}`, { id: nid, title: nid, path: `__home/${nid}`, markdown, updatedAt: id() });

test("the Home project is created once, hidden by key, and hosts one top chief", async () => {
  const h = await service.ensureHomeProject();
  assert.equal(h.dataKey, "__home");
  assert.equal((await service.ensureHomeProject()).id, h.id);
  assert.match(fs.readFileSync(path.join(tmp, "__home", "MEMORY.md"), "utf8"), /## Routing rules/);
  const top = await service.openTopChief();
  assert.deepEqual(top.meta.origin, { kind: "top_chief" });
  assert.equal((await service.openTopChief()).id, top.id);
  assert.deepEqual(prompt.disallowedToolsFor(top.meta.origin), ["Edit", "Write", "NotebookEdit", "Bash"]);
  assert.match(prompt.teamPrompt(top.meta.origin), /# Top chief/);
});

test("tags pin items, plans need approval, approval routes to project chiefs and marks the note", async () => {
  addNote("today", "## Marketing site\n- [ ] new hero copy\n- [ ] fix login #thunk/onboarding\n## Misc\n- [ ] mystery item\n- [x] old thing #thunk");
  const top = await service.openTopChief();
  const { open, message } = await service.routeRequest("today", "delegate");
  assert.equal(open, 3);
  assert.match(message, /line 1: new hero copy → pinned to Marketing Site .* by heading/);
  assert.match(message, new RegExp(`line 2: fix login #thunk/onboarding → pinned to Thunk .*workspace ${onboarding.id}`));
  assert.match(message, /line 4: mystery item → not pinned/);

  await assert.rejects(service.proposeRoutePlan(top.id, { summary: "x", noteId: "today", items: [{ projectId: thunk.id, title: "Hero", brief: "b", why: "w", line: 1 }] }), /pinned to Marketing Site/);
  await assert.rejects(service.proposeRoutePlan(top.id, { summary: "x", items: [{ projectId: id(), title: "t", brief: "b", why: "w" }] }), /Unknown project/);
  await assert.rejects(service.proposeRoutePlan(chiefs.get(thunk.id)?.id ?? id(), { summary: "x", items: [{ projectId: thunk.id, title: "t", brief: "b", why: "w" }] }), /Only the top chief/);

  const plan = await service.proposeRoutePlan(top.id, { summary: "Two items", noteId: "today", items: [
    { projectId: site.id, title: "New hero copy", brief: "Write the hero", why: "## heading", line: 1 },
    { projectId: thunk.id, workspaceId: onboarding.id, title: "Fix login", brief: "Fix it", why: "#thunk/onboarding", line: 2 },
  ] });
  assert.equal(plan.status, "pending");
  const card = notifications.at(-1);
  assert.equal(card.kind, "delegation_plan");
  assert.match(card.title, /2 items across 2 projects/);
  assert.equal(card.actions[0].path, `/api/chief/routes/${plan.planId}`);
  assert.equal(chiefs.size, 0, "nothing is routed before approval");

  const decided = await service.decideRoutePlan(plan.planId, "approve");
  assert.equal(decided.results.filter((r) => r.ref).length, 2);
  await assert.rejects(service.decideRoutePlan(plan.planId, "approve"), /already approved/);
  assert.deepEqual(resolved, [`top-chief:plan:${plan.planId}`]);
  const thunkChief = chiefs.get(thunk.id);
  assert.match(messages(thunkChief)[0], new RegExp(`<routed_request id="[0-9a-f]{8}" from="top chief">\\nFix login[\\s\\S]*workspace ${onboarding.id}`));
  assert.match(messages(top).at(-1), /<route_plan id=.* status="approved">/);
  const md = notes.get("__home/today").markdown.split("\n");
  assert.match(md[1], /^- \[ \] new hero copy → Marketing Site: routed \(r:[0-9a-f]{8}\)$/);
  assert.match(md[2], /^- \[ \] fix login #thunk\/onboarding → Thunk: routed \(r:[0-9a-f]{8}\)$/);
  assert.equal((await service.noteItems("today")).open, 1, "routed lines are not offered again");

  const ref = decided.results.find((r) => r.project === "Thunk").ref;
  await assert.rejects(service.reportRoute(site.id, ref, "done", "wrong project"), /No request/);
  await service.reportRoute(thunk.id, ref, "done", "Login fixed on thunk/onboarding");
  assert.match(notes.get("__home/today").markdown.split("\n")[2], /^- \[x\] fix login #thunk\/onboarding → Thunk: done \(r:/);
  assert.match(messages(top).at(-1), /<route_report id=".*" project="Thunk" status="done">/);
  const status = await service.routesStatus();
  assert.equal(status.open.length, 1);
  assert.equal(status.settledThisWeek.length, 1);
});

test("rejection tells the top chief; routing rules are saved once", async () => {
  const top = await service.openTopChief();
  const plan = await service.proposeRoutePlan(top.id, { summary: "One", items: [{ projectId: site.id, title: "Mystery", brief: "b", why: "guess" }] });
  await service.decideRoutePlan(plan.planId, "reject", "That is Thunk work");
  assert.match(messages(top).at(-1), /status="rejected">\nThe person rejected this plan: That is Thunk work/);
  assert.deepEqual(await service.saveRoutingRule("Mystery work goes to Thunk"), { saved: true });
  assert.deepEqual(await service.saveRoutingRule("Mystery  work goes to Thunk"), { saved: false, reason: "Already saved" });
  assert.match(fs.readFileSync(path.join(tmp, "__home", "MEMORY.md"), "utf8"), /## Routing rules\n- Mystery work goes to Thunk/);
});

test("triage wakes the top chief only when there is something new, and schedules the next run", async () => {
  const top = await service.openTopChief();
  const before = messages(top).length;
  const first = await triage.runTriage("manual");
  assert.equal(first.open, 1);
  assert.match(messages(top).at(-1), /<triage reason="manual"[\s\S]*mystery item[\s\S]*top_log/);
  addNote("done", "- [x] finished");
  notes.get("__home/today").markdown = notes.get("__home/today").markdown.replace("- [ ] mystery item", "- [x] mystery item");
  const second = await triage.runTriage("scheduled");
  assert.equal(second.result, "Nothing new to route");
  assert.equal(messages(top).length, before + 1);
  const saved = await triage.saveTriage({ enabled: true, cron: "30 8 * * 1-5", tz: "UTC" });
  assert.ok(saved.nextRunAt && Date.parse(saved.nextRunAt) > Date.now());
  assert.match(saved.lastResult, /Nothing new/);
  assert.throws(() => triage.TriageInput.parse({ enabled: true, cron: "* * *" }), /five fields/);
});
