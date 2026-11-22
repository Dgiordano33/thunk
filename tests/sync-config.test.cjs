/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const target = path.join(__dirname, "..", request.slice(2));
    request = fs.existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, "index.ts");
  }
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return load.call(this, request, parent, isMain);
};

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "thunk-setup-sync-")));
process.env.THUNK_DATA_DIR = path.join(base, "data");
const portable = require("../lib/setup/portable.ts");
const sync = require("../lib/setup/sync.ts");
const { readAgentSettings } = require("../lib/setup/settings.ts");
const client = require("../desktop/setup-sync.cjs");

const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const read = (file) => fs.readFileSync(file, "utf8");

test("Claude settings lose only hooks and the status line", () => {
  const input = { model: "opus", hooks: { Stop: [] }, statusLine: { type: "command" }, permissions: { allow: ["Bash(ls)"] } };
  const { settings, dropped } = portable.serverClaudeSettings(input);
  assert.deepEqual(settings, { model: "opus", permissions: { allow: ["Bash(ls)"] } });
  assert.deepEqual(dropped, ["hooks", "statusLine"]);
  assert.ok(input.hooks, "the input is not modified");
});

test("MCP servers are kept only when they can run here", () => {
  const servers = {
    remote: { type: "http", url: "https://mcp.example.com/mcp" },
    local: { url: "http://127.0.0.1:29979/mcp" },
    app: { command: "/Applications/ChatGPT.app/Contents/Resources/node_repl" },
    relative: { command: "./Thing.app/Contents/MacOS/thing" },
    npx: { command: "npx", args: ["-y", "pkg"] },
    hs: { command: "hs" },
    off: { command: "npx", enabled: false },
  };
  const { kept, dropped } = portable.portableServers(servers, (c) => c === "npx");
  assert.deepEqual(Object.keys(kept), ["remote", "npx"]);
  assert.deepEqual(Object.fromEntries(dropped.map((d) => [d.name, d.reason])), {
    local: "runs on the Mac's localhost", app: "macOS-only path", relative: "relative path", hs: "`hs` is not installed here", off: "disabled",
  });
});

const CODEX = `notify = [ "/Users/me/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/Client", "turn-ended" ]
model = "gpt-6"
instructions = """
A [bracket] line
[not_a_table]
"""

[marketplaces.bundled]
source = "/Users/me/.codex/.tmp/bundled"

[plugins."browser@bundled"]
enabled = true

[features]
js_repl = false

[mcp_servers.node_repl]
command = "/Applications/ChatGPT.app/Contents/Resources/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/me/.codex"

[mcp_servers.heyreach]
url = "https://mcp.heyreach.io/mcp?key=secret"

[mcp_servers.paper]
url = "http://127.0.0.1:29979/mcp"

[mcp_servers."with.dot"]
command = "npx"
args = [
  "-y",
  "[pkg]",
]

[desktop]
sansFontSize = 14

[projects."/Users/me/code/app"]
trust_level = "trusted"

[[skills.config]]
path = "/Users/me/.codex/skills/pet/SKILL.md"
enabled = false

[hooks.state."x@y:hooks.json:session_start:0:0"]
trusted_hash = "sha256:abc"
`;

test("Codex MCP servers are read from their tables", () => {
  assert.deepEqual(Object.keys(portable.codexMcpServers(CODEX)), ["node_repl", "heyreach", "paper", "with.dot"]);
  assert.equal(portable.codexMcpServers(CODEX)["with.dot"].command, "npx");
});

test("the Codex config keeps model settings, features, projects, skills and chosen MCP servers", () => {
  const { text, dropped } = portable.serverCodexConfig(CODEX, new Set(["heyreach", "with.dot"]));
  assert.doesNotMatch(text, /notify|marketplaces|plugins|desktop|hooks\.state|node_repl|paper|Applications/);
  assert.match(text, /^model = "gpt-6"$/m);
  assert.match(text, /instructions = """\nA \[bracket\] line\n\[not_a_table\]\n"""/, "multi-line strings stay whole");
  assert.match(text, /\[mcp_servers\."with\.dot"\]\ncommand = "npx"\nargs = \[\n  "-y",\n  "\[pkg\]",\n\]/, "multi-line arrays stay whole");
  assert.match(text, /\[projects\."\/Users\/me\/code\/app"\]\ntrust_level = "trusted"/);
  assert.match(text, /\[\[skills\.config\]\]\npath = /);
  assert.deepEqual(dropped.sort(), ["desktop", "hooks", "marketplaces", "notify", "plugins"]);
});

test("rehome swaps the sender's home in nested paths", () => {
  assert.deepEqual(portable.rehome({ a: ["/Users/me/.claude/x"], b: "/Users/meow" }, "/Users/me", "/home/me"), { a: ["/home/me/.claude/x"], b: "/Users/meow" });
  assert.equal(portable.rehome('path = "/Users/me/.codex/x"\n', "/Users/me", "/home/me"), 'path = "/home/me/.codex/x"\n', "TOML text too");
});

test("the server refuses paths outside the sync folders", async () => {
  const home = path.join(base, "escape");
  fs.mkdirSync(path.join(home, ".claude/skills"), { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(home, ".claude/skills/out"));
  assert.equal(sync.SyncInput.safeParse({ step: "files", files: [{ root: "claude-skills", path: "../settings.json", data: "" }] }).success, false);
  assert.equal(sync.SyncInput.safeParse({ step: "files", files: [{ root: "claude-skills", path: "/etc/passwd", data: "" }] }).success, false);
  assert.equal(sync.SyncInput.safeParse({ step: "files", files: [{ root: "home", path: "x", data: "" }] }).success, false);
  await assert.rejects(sync.writeSyncFiles([{ root: "claude-skills", path: "out/evil.txt", data: "" }], home), /Invalid path/);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), "evil.txt")), false);
});

test("a Mac's setup syncs end to end, and a second sync sends nothing", async () => {
  const mac = path.join(base, "Users", "me");
  const server = path.join(base, "home", "me");
  const repoSkill = path.join(base, "repo", "skills", "brand");
  write(path.join(repoSkill, "SKILL.md"), "---\nname: brand\n---\n");
  fs.mkdirSync(path.join(mac, ".claude/skills"), { recursive: true });
  fs.symlinkSync(repoSkill, path.join(mac, ".claude/skills/brand"));
  write(path.join(mac, ".claude/skills/synced/x/SKILL.md"), "claude.ai sync");
  write(path.join(mac, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "tool@market": true, "off@market": false }, hooks: { Stop: [] }, permissions: { additionalDirectories: [`${mac}/code`] } }));
  write(path.join(mac, ".claude.json"), JSON.stringify({ mcpServers: { remote: { type: "http", url: "https://mcp.example.com" }, mac: { command: "/Applications/X.app/bin/x" } }, oauthAccount: { secret: true } }));
  const install = path.join(mac, ".claude/plugins/cache/market/tool/1.0.0");
  write(path.join(install, "skills/t/SKILL.md"), "plugin skill");
  write(path.join(install, "bin/run"), "#!/bin/sh\n");
  fs.chmodSync(path.join(install, "bin/run"), 0o755);
  write(path.join(mac, ".claude/plugins/cache/market/off/1.0.0/x"), "not enabled");
  write(path.join(mac, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "tool@market": [{ scope: "project", installPath: install }, { scope: "user", installPath: install }], "off@market": [{ scope: "user", installPath: path.join(mac, ".claude/plugins/cache/market/off/1.0.0") }] } }));
  write(path.join(mac, ".claude/plugins/known_marketplaces.json"), JSON.stringify({ market: { installLocation: path.join(mac, ".claude/plugins/marketplaces/market") }, other: { installLocation: path.join(mac, ".claude/plugins/marketplaces/other") } }));
  write(path.join(mac, ".claude/plugins/marketplaces/market/.claude-plugin/marketplace.json"), "{}");
  write(path.join(mac, ".claude/plugins/marketplaces/market/.git/HEAD"), "ref");
  write(path.join(mac, ".claude/plugins/marketplaces/other/big"), "unused marketplace");
  write(path.join(mac, ".codex/config.toml"), CODEX);
  write(path.join(mac, ".codex/skills/pet/SKILL.md"), "codex skill");
  write(path.join(mac, ".codex/skills/.system/x/SKILL.md"), "bundled");
  write(path.join(server, ".claude.json"), JSON.stringify({ userID: "server", mcpServers: { browser: { command: "npx" } } }));
  write(path.join(server, ".codex/config.toml"), "model = \"old\"\n");

  // The client talks to the route's logic directly, as app/api/setup/sync/route.ts would.
  const posts = [];
  const fetchImpl = async (_url, init) => {
    const body = sync.SyncInput.parse(JSON.parse(init.body));
    posts.push(body.step);
    const result = body.step === "plan" ? await sync.planSync(body.manifest, server)
      : body.step === "files" ? await sync.writeSyncFiles(body.files, server)
      : await sync.finishSync(body, { home: server, has: (c) => c === "npx" });
    return { ok: true, status: 200, json: async () => result };
  };
  const summary = await client.syncSetup({ baseUrl: "https://thunk.example.ts.net", home: mac, fetchImpl });
  assert.deepEqual(posts, ["plan", "files", "finish"]);
  assert.deepEqual(summary.claude.skills, ["brand"]);
  assert.deepEqual(summary.claude.plugins, ["tool@market"]);
  assert.deepEqual(summary.claude.mcp.kept, ["remote"]);
  assert.deepEqual(summary.codex.skills, ["pet"]);
  assert.deepEqual(summary.codex.mcp.kept, ["heyreach", "with.dot"]);

  assert.equal(read(path.join(server, ".claude/skills/brand/SKILL.md")), "---\nname: brand\n---\n", "symlinked skills arrive as files");
  assert.equal(fs.existsSync(path.join(server, ".claude/skills/synced")), false);
  assert.equal(read(path.join(server, ".claude/plugins/cache/market/tool/1.0.0/skills/t/SKILL.md")), "plugin skill");
  assert.equal(fs.statSync(path.join(server, ".claude/plugins/cache/market/tool/1.0.0/bin/run")).mode & 0o111, 0o111, "executables stay executable");
  assert.equal(fs.existsSync(path.join(server, ".claude/plugins/cache/market/off")), false, "disabled plugins stay behind");
  assert.ok(fs.existsSync(path.join(server, ".claude/plugins/marketplaces/market/.claude-plugin/marketplace.json")));
  assert.equal(fs.existsSync(path.join(server, ".claude/plugins/marketplaces/market/.git")), false);
  assert.equal(fs.existsSync(path.join(server, ".claude/plugins/marketplaces/other")), false, "unused marketplaces stay behind");
  assert.ok(fs.existsSync(path.join(server, ".codex/skills/pet/SKILL.md")));
  assert.equal(fs.existsSync(path.join(server, ".codex/skills/.system")), false);

  const installed = JSON.parse(read(path.join(server, ".claude/plugins/installed_plugins.json")));
  assert.deepEqual(Object.keys(installed.plugins), ["tool@market"]);
  assert.equal(installed.plugins["tool@market"][0].installPath, path.join(server, ".claude/plugins/cache/market/tool/1.0.0"), "plugin paths use the server's home");
  const settings = JSON.parse(read(path.join(server, ".claude/settings.json")));
  assert.equal(settings.hooks, undefined);
  assert.deepEqual(settings.permissions.additionalDirectories, [`${server}/code`]);
  const claudeJson = JSON.parse(read(path.join(server, ".claude.json")));
  assert.equal(claudeJson.userID, "server", "the server's own Claude state is kept");
  assert.equal(claudeJson.oauthAccount, undefined, "nothing else comes from the Mac's ~/.claude.json");
  assert.deepEqual(Object.keys(claudeJson.mcpServers), ["browser", "remote"]);
  assert.equal(fs.statSync(path.join(server, ".claude.json")).mode & 0o777, 0o600);
  assert.match(read(path.join(server, ".codex/config.toml")), /model = "gpt-6"/);
  assert.ok(fs.readdirSync(path.join(server, ".codex")).some((f) => f.startsWith("config.toml.bak-")), "the replaced Codex config is kept");
  assert.equal((await readAgentSettings()).claudeUserConfig, true, "syncing turns the setup on");

  const status = await sync.setupStatus(server);
  assert.equal(status.claudeUserConfig, true);
  assert.deepEqual(status.here.claude.skills, ["brand"]);
  assert.deepEqual(status.lastSync.claude.plugins, ["tool@market"]);

  posts.length = 0;
  const again = await client.syncSetup({ baseUrl: "https://thunk.example.ts.net", home: mac, fetchImpl });
  assert.deepEqual(posts, ["plan", "finish"], "unchanged files are not sent again");
  assert.equal(again.files.uploaded, 0);
});
