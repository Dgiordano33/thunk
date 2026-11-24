const { spawn, execFileSync } = require("node:child_process");
const { createServer } = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");
const { readFileSync, existsSync } = require("node:fs");
const { parseEnv } = require("node:util");

/** THUNK_PORT from the desktop config pins the port so Tailscale Serve can target it (docs/remote.md). */
function configuredPort(config) {
  let value;
  try {
    value = parseEnv(readFileSync(config, "utf8")).THUNK_PORT;
  } catch {
    return undefined;
  }
  if (!value?.trim()) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`THUNK_PORT must be a port number, got "${value}".`);
  return port;
}

/**
 * THUNK_REMOTE_URL from the desktop config makes the app a window onto a Thunk server (docs/server.md)
 * instead of starting its own. Returns the server's origin, or undefined when unset.
 */
function configuredRemote(config) {
  let value;
  try {
    value = parseEnv(readFileSync(config, "utf8")).THUNK_REMOTE_URL;
  } catch {
    return undefined;
  }
  if (!value?.trim()) return undefined;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`THUNK_REMOTE_URL must be a URL such as https://thunk.example.ts.net, got "${value}".`);
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error(`THUNK_REMOTE_URL must start with https://, got "${value}".`);
  return url.origin;
}

function loginPath() {
  // Windows apps inherit the user's PATH from Explorer; there is no login shell to ask.
  if (process.platform === "win32") return process.env.PATH || process.env.Path || "";
  // Finder and Linux app launchers do not inherit the user's terminal PATH (nvm, Homebrew, Codex, gh).
  try {
    const output = execFileSync(process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), ["-ilc", 'printf "\\nTHUNK_PATH=%s\\n" "$PATH"'], {
      encoding: "utf8", timeout: 10000,
    });
    return output.split("\n").find((line) => line.startsWith("THUNK_PATH="))?.slice(11) || process.env.PATH;
  } catch {
    return process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
}

/** The bundled tool folders: `bin`, plus a bundled Git for Windows (MinGit) when packaged with one. */
function toolPath(root) {
  const dirs = [path.join(root, "bin")];
  const git = path.join(root, "bin", "git", "cmd");
  if (existsSync(git)) dirs.push(git);
  return dirs.join(path.delimiter);
}

/** The bundled Node executable. */
function nodeBinary(root, platform = process.platform) {
  return path.join(root, "bin", platform === "win32" ? "node.exe" : "node");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startBackend({ root, config, log, env = process.env, timeout = 60000 }) {
  const port = configuredPort(config) ?? await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(nodeBinary(root), [
    `--env-file-if-exists=${config}`, path.join(root, "server/server.js"),
  ], {
    cwd: path.dirname(config),
    env: { ...env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
      PATH: [toolPath(root), env.PATH || ""].join(path.delimiter), NEXT_TELEMETRY_DISABLED: "1" },
    windowsHide: true,
    // Windows cannot deliver SIGTERM; an IPC channel lets stop() ask for a clean shutdown instead.
    stdio: process.platform === "win32" ? ["ignore", log, log, "ipc"] : ["ignore", log, log],
  });
  let failure;
  child.once("error", (error) => { failure = error; });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      failure = new Error(`Thunk server stopped (${signal || code}).`);
      resolve();
    });
    child.once("error", resolve);
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode || !child.pid) return;
    if (child.connected) child.send("thunk:shutdown");
    else child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  };
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok && !failure) return { url, child, stop, exited };
      } catch { /* Server is still starting. */ }
      await delay(100);
    }
    throw new Error("Thunk server did not become ready within 60 seconds.");
  } catch (error) {
    await stop();
    throw error;
  }
}

function externalUrl(value) {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

module.exports = { startBackend, configuredRemote, loginPath, toolPath, nodeBinary, externalUrl };
