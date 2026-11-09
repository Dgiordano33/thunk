/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { mkdtempSync, realpathSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const target = path.join(__dirname, "..", request.slice(2));
    request = require("node:fs").existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, "index.ts");
  }
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "../server") return { db: () => null }; // Memory mode: never connect to a configured database.
  return load.call(this, request, parent, isMain);
};

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "thunk-project-config-")));
process.env.THUNK_DATA_DIR = path.join(base, "data");
const projects = require("../lib/projects/index.ts");
const paths = require("../lib/projects/paths.ts");

test.after(() => fs.rm(base, { recursive: true, force: true }));
const { Connectors, readConnectors, saveConnectors, maskConnectors, codexConnectors } = require("../lib/projects/connectors.ts");
const { buildOptions, hierarchyPrompt } = require("../lib/agent/options.ts");

test("connector validation, masking and conflict-safe round trips", async () => {
  const key = "connectors";
  const config = { mcpServers: {
    local: { command: "node", args: ["server.js"], env: { TOKEN: "secret" } },
    remote: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer secret" } },
    legacy: { type: "sse", url: "https://example.com/sse" },
  } };
  const empty = await readConnectors(key);
  await saveConnectors(key, config, empty.revision);
  const saved = await readConnectors(key);
  const masked = maskConnectors(saved.config);
  assert.ok(!JSON.stringify(masked).includes("secret"));
  masked.mcpServers.local.args.push("--verbose");
  await saveConnectors(key, masked, saved.revision);
  const after = await readConnectors(key);
  assert.equal(after.config.mcpServers.local.env.TOKEN, "secret");
  assert.equal(after.config.mcpServers.remote.headers.Authorization, "Bearer secret");
  await assert.rejects(saveConnectors(key, config, saved.revision), (err) => err.status === 409);
  assert.equal((await fs.stat(paths.projectConnectorsFile(key))).mode & 0o777, 0o600);
  assert.equal(Connectors.safeParse({ mcpServers: { thunk: { command: "node" } } }).success, false);
  assert.equal(Connectors.safeParse({ mcpServers: { bad: { type: "http", url: "file:///tmp/x" } } }).success, false);
  assert.equal(Connectors.safeParse({ mcpServers: { bad: { command: "" } } }).success, false);
  assert.equal(Connectors.safeParse({ mcpServers: { bad: { type: "http", url: "invalid" } } }).success, false);
  const codex = codexConnectors(after.config);
  assert.equal(codex.local.env.TOKEN, "secret");
  assert.equal(codex.remote.http_headers.Authorization, "Bearer secret");
  assert.equal(codex.legacy, undefined);
});

test("invalid connectors are skipped and can be repaired without leaking their contents", async () => {
  const key = "broken";
  await fs.mkdir(paths.projectConfigDir(key), { recursive: true });
  await fs.writeFile(paths.projectConnectorsFile(key), '{"secret-token":');
  const broken = await readConnectors(key);
  assert.deepEqual(broken.config.mcpServers, {});
  assert.ok(broken.error);
  assert.ok(!broken.error.includes("secret-token"));
  await saveConnectors(key, { mcpServers: {} }, broken.revision);
  assert.equal((await readConnectors(key)).error, null);
});

test("both providers get capped project instructions, and Claude protects project config", async () => {
  for (const withFolder of [false, true]) {
    const folder = path.join(base, "folder");
    await fs.mkdir(folder, { recursive: true });
    const { project, workspace } = await projects.createProject({ name: `Instructions ${withFolder}`, repos: withFolder ? [{ source: "existing", path: folder }] : [] });
    await fs.mkdir(paths.projectConfigDir(project.dataKey), { recursive: true });
    await fs.writeFile(paths.projectInstructionsFile(project.dataKey), "Use plain language");
    const live = { id: "test", ctx: { project, workspace }, meta: { cwd: workspace.cwd, model: "test", permissionMode: "default" }, stderrTail: [] };
    const initial = await readConnectors(project.dataKey);
    await saveConnectors(project.dataKey, { mcpServers: { example: { command: "node" } } }, initial.revision);
    const options = await buildOptions(live, {});
    assert.equal(options.mcpServers.example.command, "node");
    assert.ok(options.mcpServers.thunk);
    assert.match(options.systemPrompt.append, /Project instructions\nUse plain language/);
    assert.ok(options.sandbox.filesystem.denyWrite.includes(paths.projectConfigDir(project.dataKey)));
    assert.ok(options.settings.permissions.deny.some((rule) => rule.includes("/config/**")));
    for (const provider of ["claude", "codex"]) {
      const prompt = hierarchyPrompt(live, "memory fact", provider, undefined, [], undefined, "x".repeat(24_001));
      assert.match(prompt, /instructions truncated/);
      assert.ok(!prompt.includes("x".repeat(24_001)));
      if (provider === "codex") assert.ok(prompt.indexOf("Project instructions") < prompt.indexOf("Project memory (current contents)"));
    }
  }
});
