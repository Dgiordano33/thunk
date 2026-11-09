import { cpSync, mkdirSync, rmSync, chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

assert.equal(process.platform, "darwin", "Desktop packaging currently supports macOS only.");
assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Use Node 22 or newer.");
// A Homebrew Node may depend on libraries outside the bundle; use the official Node binary.
const libraries = execFileSync("otool", ["-L", process.execPath], { encoding: "utf8" });
assert.ok(libraries.split("\n").slice(1).every((line) => !line.trim() || /^\s+\/(usr\/lib|System\/Library)\//.test(line)),
  "Use an official standalone Node installation (e.g. nvm), not a dynamically linked Homebrew Node.");
const root = path.resolve("build/desktop");
rmSync(root, { recursive: true, force: true });
mkdirSync(path.join(root, "bin"), { recursive: true });
cpSync(process.execPath, path.join(root, "bin/node"));
chmodSync(path.join(root, "bin/node"), 0o755);
const server = path.join(root, "server");
mkdirSync(server, { recursive: true });
for (const entry of ["server.js", "package.json", "node_modules", ".next"]) {
  cpSync(path.join(".next/standalone", entry), path.join(server, entry), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => !path.basename(source).startsWith(".env"),
  });
}
cpSync("public", path.join(server, "public"), { recursive: true });
cpSync(".next/static", path.join(server, ".next/static"), { recursive: true });
// These packages load native files dynamically, beyond Next's static file tracing.
for (const name of ["node-pty", "@anthropic-ai/claude-agent-sdk", `@anthropic-ai/claude-agent-sdk-darwin-${process.arch}`]) {
  cpSync(path.join("node_modules", name), path.join(server, "node_modules", name), { recursive: true });
}
for (const relative of [`prebuilds/darwin-${process.arch}/spawn-helper`, "build/Release/spawn-helper"]) {
  const helper = path.join(server, "node_modules/node-pty", relative);
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
// Verify the copied module with the copied runtime before producing an app.
execFileSync(path.join(root, "bin/node"), ["-e", `
  const pty = require(${JSON.stringify(path.join(server, "node_modules/node-pty"))});
  const terminal = pty.spawn('/bin/sh', ['-c', 'printf THUNK_PTY_OK'], { env: process.env });
  let output = '';
  const timer = setTimeout(() => { terminal.kill(); process.exit(1); }, 5000);
  terminal.onData(data => output += data);
  terminal.onExit(({exitCode}) => { clearTimeout(timer); process.exit(exitCode === 0 && output.includes('THUNK_PTY_OK') ? 0 : 1); });
`], { stdio: "inherit" });
console.log(`Prepared desktop backend for darwin-${process.arch}`);
