const { spawn, execFileSync } = require("node:child_process");
const { createServer } = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");

function loginPath() {
  // Finder does not inherit the user's terminal PATH (nvm, Homebrew, Codex, gh).
  try {
    const output = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "\\nTHUNK_PATH=%s\\n" "$PATH"'], {
      encoding: "utf8", timeout: 10000,
    });
    return output.split("\n").find((line) => line.startsWith("THUNK_PATH="))?.slice(11) || process.env.PATH;
  } catch {
    return process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
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
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(path.join(root, "bin/node"), [
    `--env-file-if-exists=${config}`, path.join(root, "server/server.js"),
  ], {
    cwd: path.dirname(config),
    env: { ...env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
      PATH: `${path.join(root, "bin")}:${env.PATH || ""}`, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", log, log],
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
    child.kill("SIGTERM");
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

module.exports = { startBackend, loginPath, externalUrl };
