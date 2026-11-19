const { spawn, execFileSync } = require("node:child_process");
const { mkdtempSync, cpSync, renameSync, rmSync, openSync, closeSync, accessSync, realpathSync, readFileSync, constants } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");

const DEFAULT_UPDATE_SOURCE = { repo: "https://github.com/Dgiordano33/thunk.git", branch: "main" };

/**
 * Where Check for Updates builds from. THUNK_UPDATE_REPO (a git URL, a local path, or GitHub
 * `owner/repo` shorthand) and THUNK_UPDATE_BRANCH in the desktop config point a fork at itself.
 */
function configuredUpdateSource(config) {
  let values = {};
  try {
    values = parseEnv(readFileSync(config, "utf8"));
  } catch {
    // A missing or unreadable config uses the defaults.
  }
  const repoValue = values.THUNK_UPDATE_REPO?.trim();
  const branch = values.THUNK_UPDATE_BRANCH?.trim() || DEFAULT_UPDATE_SOURCE.branch;
  let repo = DEFAULT_UPDATE_SOURCE.repo;
  if (repoValue) {
    if (repoValue.startsWith("-")) throw new Error(`THUNK_UPDATE_REPO must be a git URL or owner/repo, got "${repoValue}".`);
    repo = /^[\w.-]+\/[\w.-]+$/.test(repoValue) && !repoValue.startsWith(".") ? `https://github.com/${repoValue.replace(/\.git$/, "")}.git` : repoValue;
  }
  if (branch.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{/.test(branch)) throw new Error(`THUNK_UPDATE_BRANCH must be a branch name, got "${branch}".`);
  return { repo, branch };
}

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

async function prepareUpdate({ target, revision, env, logFile, signal, source = DEFAULT_UPDATE_SOURCE, onProgress = () => {} }) {
  accessSync(path.dirname(target), constants.W_OK);
  const work = realpathSync(mkdtempSync(path.join(tmpdir(), "thunk-update-")));
  const log = openSync(logFile, "w", 0o600);
  let staging;
  try {
    const checkout = path.join(work, "source");
    const options = { cwd: work, env: { ...env, THUNK_DATA_DIR: path.join(work, "data"), NEXT_TELEMETRY_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" }, log, signal };
    await run("git", ["clone", "--depth=1", `--branch=${source.branch}`, "--single-branch", "--", source.repo, checkout], options);
    const latest = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, env: options.env, encoding: "utf8", timeout: 10000 }).trim();
    if (latest === revision) return null;
    options.cwd = checkout;
    onProgress("Downloading what’s new…");
    await run("npm", ["ci", "--include=dev"], options);
    onProgress("Building your update…");
    await run("npm", ["run", "desktop:pack"], options);
    onProgress("Verifying your update…");
    const built = path.join(checkout, "dist-desktop", process.arch === "arm64" ? "mac-arm64" : "mac", "Thunk.app");
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

module.exports = { prepareUpdate, installUpdate, run, configuredUpdateSource, DEFAULT_UPDATE_SOURCE };
