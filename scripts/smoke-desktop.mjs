import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, openSync, closeSync, readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import runtime from "../desktop/runtime.cjs";

const root = path.resolve(process.argv[2] || "build/desktop");
// No packaged credentials or symlinks back into the build machine.
function checkFiles(folder) {
  for (const name of readdirSync(folder)) {
    const file = path.join(folder, name);
    assert.ok(!name.startsWith(".env"), `Packaged environment file: ${file}`);
    const info = lstatSync(file);
    if (info.isSymbolicLink()) assert.ok(realpathSync(file).startsWith(root + path.sep), `External symlink: ${file}`);
    else if (info.isDirectory()) checkFiles(file);
  }
}
checkFiles(root);
const temporary = mkdtempSync(path.join(tmpdir(), "thunk-desktop-smoke-"));
const config = path.join(temporary, ".env");
writeFileSync(config, "");
const logFile = path.join(temporary, "server.log");
const log = openSync(logFile, "w");
let backend;
try {
  backend = await runtime.startBackend({ root, config, log, env: {
    PATH: process.env.PATH, HOME: temporary, SHELL: "/bin/zsh",
    THUNK_DATA_DIR: path.join(temporary, "data"), SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
  } });
  const html = await (await fetch(backend.url)).text();
  const asset = html.match(/src="([^" ]*\/_next\/static\/[^" ]+)"/);
  assert.ok(asset, "Page contains bundled static assets");
  assert.equal((await fetch(new URL(asset[1], backend.url))).status, 200);
  assert.equal((await fetch(`${backend.url}/api/models`)).status, 200);
  assert.equal((await fetch(`${backend.url}/api/models`, { headers: { origin: "https://example.com" } })).status, 403);
  const node = path.join(root, "bin/node");
  execFileSync(node, ["-e", `
    const pty = require(${JSON.stringify(path.join(root, "server/node_modules/node-pty"))});
    const terminal = pty.spawn('/bin/sh', ['-c', 'printf THUNK_SMOKE_OK'], {env: process.env});
    let output = '';
    const timer = setTimeout(() => { terminal.kill(); process.exit(1); }, 5000);
    terminal.onData(data => output += data);
    terminal.onExit(({exitCode}) => { clearTimeout(timer); process.exit(exitCode === 0 && output.includes('THUNK_SMOKE_OK') ? 0 : 1); });
  `]);
  const claude = path.join(root, `server/node_modules/@anthropic-ai/claude-agent-sdk-darwin-${process.arch}/claude`);
  assert.match(execFileSync(claude, ["--version"], { encoding: "utf8", timeout: 10000 }), /Claude/);
  await backend.stop();
  await assert.rejects(fetch(backend.url));
  console.log("Desktop smoke passed: assets, API, origin protection, native PTY, Claude binary, shutdown, package isolation.");
} catch (error) {
  console.error(readFileSync(logFile, "utf8"));
  throw error;
} finally {
  await backend?.stop();
  closeSync(log);
  rmSync(temporary, { recursive: true, force: true });
}
