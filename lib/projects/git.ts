import "server-only";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

async function tryGit(cwd: string, args: string[]) {
  return git(cwd, args).catch(() => null);
}

export async function resolveDirectory(input: string): Promise<string> {
  const expanded = input.trim().replace(/^~(?=$|\/)/, os.homedir());
  const abs = path.resolve(expanded);
  const s = await stat(abs).catch(() => null);
  if (!s?.isDirectory()) throw new Error(`Not a directory: ${abs}`);
  return abs;
}

export type DetectedProject = {
  root: string;
  name: string;
  kind: "repo" | "folder";
  remote: string | null;
  defaultBranch: string | null;
};

/** Resolve a path to its project: the git toplevel when inside a repo (any worktree), else the folder itself. */
export async function detectProject(input: string): Promise<DetectedProject> {
  const dir = await resolveDirectory(input);
  const toplevel = await tryGit(dir, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) return { root: dir, name: path.basename(dir), kind: "folder", remote: null, defaultBranch: null };

  // If `dir` is a linked worktree, the main checkout is the project root.
  const commonDir = await tryGit(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const root = commonDir && path.basename(commonDir) === ".git" ? path.dirname(commonDir) : toplevel;

  const remote = await tryGit(root, ["remote", "get-url", "origin"]);
  const originHead = await tryGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const defaultBranch =
    originHead?.replace(/^origin\//, "") ??
    (await tryGit(root, ["symbolic-ref", "--short", "HEAD"])) ??
    null;
  return { root, name: path.basename(root), kind: "repo", remote, defaultBranch };
}

async function ensureExcluded(root: string, pattern: string) {
  const gitDir = await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const exclude = path.join(gitDir, "info", "exclude");
  await mkdir(path.dirname(exclude), { recursive: true });
  const current = await readFile(exclude, "utf8").catch(() => "");
  if (!current.split("\n").includes(pattern)) await appendFile(exclude, `${current.endsWith("\n") || !current ? "" : "\n"}${pattern}\n`);
}

/** Pick the ref a new worktree branches from: origin/<default> when it exists, else local HEAD. */
export async function pickBaseRef(root: string, defaultBranch: string | null) {
  if (defaultBranch) {
    const remoteRef = `origin/${defaultBranch}`;
    if (await tryGit(root, ["rev-parse", "--verify", "--quiet", remoteRef])) return remoteRef;
    if (await tryGit(root, ["rev-parse", "--verify", "--quiet", defaultBranch])) return defaultBranch;
  }
  return "HEAD";
}

export async function branchExists(root: string, branch: string) {
  return Boolean(await tryGit(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]));
}

export async function createWorktree(opts: { root: string; path: string; branch: string; baseRef: string }) {
  await ensureExcluded(opts.root, ".claude/worktrees/");
  await mkdir(path.dirname(opts.path), { recursive: true });
  const args = (await branchExists(opts.root, opts.branch))
    ? ["worktree", "add", opts.path, opts.branch]
    : ["worktree", "add", "-b", opts.branch, opts.path, opts.baseRef];
  await git(opts.root, args);
}

export async function removeWorktree(root: string, worktree: string) {
  await git(root, ["worktree", "remove", "--force", worktree]).catch(async (err) => {
    // Already gone on disk: just drop the registration.
    if (!(await stat(worktree).catch(() => null))) return git(root, ["worktree", "prune"]);
    throw err;
  });
}

export type WorktreeStatus = {
  branch: string | null;
  dirty: number;
  ahead: number | null;
  behind: number | null;
  lastCommit: string | null;
};

export async function worktreeStatus(dir: string): Promise<WorktreeStatus | null> {
  if (!(await tryGit(dir, ["rev-parse", "--is-inside-work-tree"]))) return null;
  const branch = await tryGit(dir, ["symbolic-ref", "--short", "HEAD"]);
  const porcelain = await tryGit(dir, ["status", "--porcelain"]);
  const dirty = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const counts = await tryGit(dir, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [null, null];
  const lastCommit = await tryGit(dir, ["log", "-1", "--format=%s"]);
  return { branch, dirty, ahead, behind, lastCommit };
}
