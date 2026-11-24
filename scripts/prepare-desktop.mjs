import { copyFileSync, realpathSync, cpSync, mkdirSync, rmSync, chmodSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

// Builds build/desktop for this machine's platform and architecture: macOS, Linux or Windows.
// There is no cross-compilation; build on each target (see .github/workflows/desktop-release.yml).
const { platform, arch } = process;
assert.ok(["darwin", "linux", "win32"].includes(platform), `Desktop packaging supports macOS, Linux and Windows, not ${platform}.`);
assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Use Node 22 or newer.");
const exe = (name) => platform === "win32" ? `${name}.exe` : name;

/** Fails unless `file` links only to libraries every machine of this platform has. */
function assertSelfContained(file, what) {
  if (platform === "darwin") {
    const libraries = execFileSync("otool", ["-L", file], { encoding: "utf8" });
    assert.ok(libraries.split("\n").slice(1).every((line) => !line.trim() || /^\s+\/(usr\/lib|System\/Library)\//.test(line)), what);
  } else if (platform === "linux") {
    let libraries;
    try { libraries = execFileSync("ldd", [file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return; } // "not a dynamic executable": statically linked.
    const core = /^\s*(linux-vdso|linux-gate|\/lib\d*\/ld-linux|ld-linux|libc|libm|libdl|libpthread|librt|libgcc_s|libstdc\+\+|libatomic)\b/;
    assert.ok(libraries.split("\n").every((line) => !line.trim() || core.test(line)), what);
  }
  // Windows executables resolve their DLLs from the system or beside themselves; nothing to check.
}

// A distro or Homebrew Node may depend on libraries outside the bundle; use the official Node binary.
assertSelfContained(process.execPath, "Use an official standalone Node installation (e.g. nvm or nodejs.org), not a distro or Homebrew Node.");
const root = path.resolve("build/desktop");
const bin = path.join(root, "bin");
rmSync(root, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
writeFileSync(path.join(root, "version.json"), JSON.stringify({
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
}));
cpSync(process.execPath, path.join(bin, exe("node")));
if (platform !== "win32") chmodSync(path.join(bin, "node"), 0o755);

// Bundle native agent tools; recipients do not need Node/npm, Homebrew or a package manager.
// Codex ships one vendor folder per target triple (aarch64-apple-darwin, x86_64-unknown-linux-musl, x86_64-pc-windows-msvc…).
const vendor = path.resolve(`node_modules/@openai/codex-${platform}-${arch}/vendor`);
const [triple] = readdirSync(vendor);
assert.ok(triple, `No Codex binaries for ${platform}-${arch}; run npm ci on this machine.`);
const codex = path.join(vendor, triple);
cpSync(path.join(codex, "bin"), bin, { recursive: true });
cpSync(path.join(codex, "codex-path", exe("rg")), path.join(bin, exe("rg")));
// Linux Codex sandboxes commands with its own bubblewrap, found beside bin/ like in the npm package.
if (existsSync(path.join(codex, "codex-resources"))) cpSync(path.join(codex, "codex-resources"), path.join(root, "codex-resources"), { recursive: true });

const gh = execFileSync(platform === "win32" ? "where.exe" : "/usr/bin/which", ["gh"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
assertSelfContained(realpathSync(gh), "GitHub CLI must not depend on external libraries.");
copyFileSync(realpathSync(gh), path.join(bin, exe("gh")));
if (platform !== "win32") chmodSync(path.join(bin, "gh"), 0o755);

// Windows has no system Git. Point THUNK_MINGIT_DIR at an unzipped MinGit (github.com/git-for-windows/git
// releases, MinGit-*-64-bit.zip) to bundle it; runtime.cjs then puts bin/git/cmd on PATH.
if (platform === "win32" && process.env.THUNK_MINGIT_DIR) {
  cpSync(path.resolve(process.env.THUNK_MINGIT_DIR), path.join(bin, "git"), { recursive: true });
  execFileSync(path.join(bin, "git", "cmd", "git.exe"), ["--version"], { stdio: "inherit" });
}

for (const command of ["codex", "gh"]) execFileSync(path.join(bin, exe(command)), ["--version"], { stdio: "inherit" });
writeFileSync(path.join(root, "tool-versions.json"), JSON.stringify({
  codex: execFileSync(path.join(bin, exe("codex")), ["--version"], { encoding: "utf8" }).trim(),
  gh: execFileSync(gh, ["--version"], { encoding: "utf8" }).trim(),
  ...(existsSync(path.join(bin, "git")) ? { git: execFileSync(path.join(bin, "git", "cmd", "git.exe"), ["--version"], { encoding: "utf8" }).trim() } : {}),
}, null, 2));

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
// lib/db/server.ts applies these at startup from <cwd>/db/migrations.
cpSync("db/migrations", path.join(server, "db/migrations"), { recursive: true });
cpSync(".next/static", path.join(server, ".next/static"), { recursive: true });

// These packages load native files dynamically, beyond Next's static file tracing.
// On Linux the Claude SDK has glibc and musl builds; bundle whichever npm installed.
const claudePackages = [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`, ...(platform === "linux" ? [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}-musl`] : [])]
  .filter((name) => existsSync(path.join("node_modules", name)));
assert.ok(claudePackages.length, `No Claude Agent SDK binary for ${platform}-${arch}; run npm ci on this machine.`);
for (const name of ["node-pty", "@anthropic-ai/claude-agent-sdk", ...claudePackages]) {
  cpSync(path.join("node_modules", name), path.join(server, "node_modules", name), { recursive: true });
}
// node-pty ships prebuilds for macOS and Windows and compiles from source on Linux (build/Release).
for (const relative of [`prebuilds/${platform}-${arch}/spawn-helper`, "build/Release/spawn-helper"]) {
  const helper = path.join(server, "node_modules/node-pty", relative);
  if (existsSync(helper)) chmodSync(helper, 0o755);
}

// Verify the copied module with the copied runtime before producing an app.
const [shell, ...shellArgs] = platform === "win32" ? ["cmd.exe", "/d", "/c", "echo THUNK_PTY_OK"] : ["/bin/sh", "-c", "printf THUNK_PTY_OK"];
execFileSync(path.join(bin, exe("node")), ["-e", `
  const pty = require(${JSON.stringify(path.join(server, "node_modules/node-pty"))});
  const terminal = pty.spawn(${JSON.stringify(shell)}, ${JSON.stringify(shellArgs)}, { env: process.env });
  let output = '';
  const timer = setTimeout(() => { terminal.kill(); process.exit(1); }, 10000);
  terminal.onData(data => output += data);
  terminal.onExit(({exitCode}) => { clearTimeout(timer); process.exit(exitCode === 0 && output.includes('THUNK_PTY_OK') ? 0 : 1); });
`], { stdio: "inherit" });
console.log(`Prepared desktop backend for ${platform}-${arch}`);
