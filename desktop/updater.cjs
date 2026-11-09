const { spawn, execFileSync } = require("node:child_process");
const { mkdtempSync, cpSync, renameSync, rmSync, openSync, closeSync, accessSync, constants } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

function run(command, args, { cwd, env, log, signal }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", log, log] });
    const cancel = () => {
      // npm launches grandchildren; terminate the whole build process group.
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    };
    const timer = setTimeout(cancel, 30 * 60 * 1000);
    signal.addEventListener("abort", cancel, { once: true });
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("exit", (code) => {
      cleanup();
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(`${command} failed (${code ?? "terminated"}). See the update log.`));
      else resolve();
    });
  });
}

async function prepareUpdate({ target, revision, env, logFile, signal }) {
  accessSync(path.dirname(target), constants.W_OK);
  const work = mkdtempSync(path.join(tmpdir(), "thunk-update-"));
  const log = openSync(logFile, "w", 0o600);
  let staging;
  try {
    const source = path.join(work, "source");
    const options = { cwd: work, env: { ...env, THUNK_DATA_DIR: path.join(work, "data"), NEXT_TELEMETRY_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" }, log, signal };
    await run("git", ["clone", "--depth=1", "--branch=main", "--single-branch", "--", "https://github.com/Dgiordano33/thunk.git", source], options);
    const latest = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, env: options.env, encoding: "utf8", timeout: 10000 }).trim();
    if (latest === revision) return null;
    options.cwd = source;
    await run("npm", ["ci", "--include=dev"], options);
    await run("npm", ["run", "desktop:pack"], options);
    const built = path.join(source, "dist-desktop", process.arch === "arm64" ? "mac-arm64" : "mac", "Thunk.app");
    await run("node", ["scripts/smoke-desktop.mjs", path.join(built, "Contents/Resources/backend")], options);
    await run("codesign", ["--verify", "--deep", "--strict", built], options);
    signal.throwIfAborted();
    // Stage beside the installed app so the final rename stays on one filesystem.
    staging = mkdtempSync(path.join(path.dirname(target), ".thunk-update-"));
    const staged = path.join(staging, "Thunk.app");
    cpSync(built, staged, { recursive: true, verbatimSymlinks: true });
    await run("codesign", ["--verify", "--deep", "--strict", staged], options);
    return { staged, staging, revision: latest };
  } catch (error) {
    if (staging) rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally {
    closeSync(log);
    rmSync(work, { recursive: true, force: true });
  }
}

function installUpdate(staged, target) {
  const backupFolder = mkdtempSync(path.join(path.dirname(target), ".thunk-previous-"));
  const backup = path.join(backupFolder, "Thunk.app");
  renameSync(target, backup);
  try {
    renameSync(staged, target);
  } catch (error) {
    // Restore the original path if installing the replacement fails.
    renameSync(backup, target);
    rmSync(backupFolder, { recursive: true, force: true });
    throw error;
  }
  return backup;
}

module.exports = { prepareUpdate, installUpdate, run };
