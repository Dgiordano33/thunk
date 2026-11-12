import "server-only";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { repoNameFromUrl } from "./repo-spec";
import type { ChangedFile, WorkspaceChanges } from "./types";

const exec = promisify(execFile);

export async function git(cwd: string, args: string[]) {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

export async function tryGit(cwd: string, args: string[]) {
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
    ? ["worktree", "add", "--", opts.path, opts.branch]
    : ["worktree", "add", "-b", opts.branch, "--", opts.path, opts.baseRef];
  await git(opts.root, args);
}

export async function removeWorktree(root: string, worktree: string) {
  await git(root, ["worktree", "remove", worktree]).catch(async (err) => {
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

function expandHome(input: string) {
  return path.resolve(input.trim().replace(/^~(?=$|\/)/, os.homedir()));
}

/** Where `cloneRepo` would put this URL. */
export function cloneDestination(url: string, parent: string) {
  return folderDestination(parent, repoNameFromUrl(url));
}

/** Clone `url` into `<parent>/<repo>` and return the new checkout path. `owner/repo` expands to GitHub. */
export async function cloneRepo(url: string, parent: string): Promise<string> {
  const source = /^[\w.-]+\/[\w.-]+$/.test(url.trim()) ? `https://github.com/${url.trim()}.git` : url.trim();
  const dest = cloneDestination(source, parent);
  await mkdir(path.dirname(dest), { recursive: true });
  if (await stat(dest).catch(() => null)) throw new Error(`Already exists: ${dest}`);
  // Nothing can answer a credentials prompt from here, so a private or mistyped URL must fail instead of hanging.
  await exec("git", ["clone", "--", source, dest], { maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).catch((err: { stderr?: string }) => {
    throw new Error(err.stderr?.trim().split("\n").pop() || `git clone failed for ${source}`);
  });
  return dest;
}

/** Where `createFolder` would create this folder. */
export function folderDestination(parent: string, name: string) {
  name = name.trim();
  if (!name || /[/\\]/.test(name) || name === "." || name === "..") throw new Error("Folder name must be a single path segment");
  return path.join(expandHome(parent), name);
}

/** Create `<parent>/<name>` (must not exist), optionally as a fresh git repo. */
export async function createFolder(parent: string, name: string, opts: { git?: boolean } = {}): Promise<string> {
  const dest = folderDestination(parent, name);
  if (await stat(dest).catch(() => null)) throw new Error(`Already exists: ${dest}`);
  await mkdir(dest, { recursive: true });
  if (opts.git) await git(dest, ["init"]);
  return dest;
}

async function changesBase(dir: string, baseRef: string | null) {
  if (baseRef) {
    const mb = await tryGit(dir, ["merge-base", baseRef, "HEAD"]);
    if (mb) return { base: mb, baseLabel: baseRef };
  }
  const head = await tryGit(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return { base: head, baseLabel: "HEAD" };
}

async function countLines(file: string) {
  const s = await stat(file).catch(() => null);
  if (!s?.isFile() || s.size > 1024 * 1024) return 0;
  const text = await readFile(file, "utf8").catch(() => "");
  if (text.includes("\0")) return 0;
  return text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
}

/** Everything that differs from the base: committed on the branch plus uncommitted, plus untracked files. */
export async function workspaceChanges(dir: string, baseRef: string | null): Promise<WorkspaceChanges | null> {
  if (!(await tryGit(dir, ["rev-parse", "--is-inside-work-tree"]))) return null;
  const { base, baseLabel } = await changesBase(dir, baseRef);
  const files = new Map<string, ChangedFile>();

  if (base) {
    const nameStatus = (await tryGit(dir, ["diff", "--name-status", "-z", "--no-renames", base])) ?? "";
    const ns = nameStatus.split("\0").filter(Boolean);
    for (let i = 0; i + 1 < ns.length; i += 2) files.set(ns[i + 1], { path: ns[i + 1], status: ns[i][0], additions: 0, deletions: 0 });
    const numstat = (await tryGit(dir, ["diff", "--numstat", "--no-renames", base])) ?? "";
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [add, del, ...rest] = line.split("\t");
      const f = files.get(rest.join("\t"));
      if (f) Object.assign(f, { additions: Number(add) || 0, deletions: Number(del) || 0 });
    }
  }

  const untracked = (await tryGit(dir, ["ls-files", "--others", "--exclude-standard", "-z"])) ?? "";
  await Promise.all(
    untracked
      .split("\0")
      .filter(Boolean)
      .slice(0, 500)
      .map(async (p) => {
        files.set(p, { path: p, status: "U", additions: await countLines(path.join(dir, p)), deletions: 0 });
      }),
  );

  await Promise.all([...files.values()].map(async (file) => {
    file.mtimeMs = (await stat(path.join(dir, file.path)).catch(() => null))?.mtimeMs ?? 0;
  }));
  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    base,
    baseLabel,
    files: list,
    additions: list.reduce((n, f) => n + f.additions, 0),
    deletions: list.reduce((n, f) => n + f.deletions, 0),
  };
}

/** Unified diff of one changed file against the workspace base. `file` must come from workspaceChanges. */
export async function workspaceFileDiff(dir: string, baseRef: string | null, file: ChangedFile): Promise<string> {
  if (file.status === "U") {
    // --no-index exits 1 when files differ; the diff is still on stdout.
    return exec("git", ["diff", "--no-index", "--", "/dev/null", file.path], { cwd: dir, maxBuffer: 4 * 1024 * 1024 })
      .then((r) => r.stdout)
      .catch((err: { stdout?: string }) => err.stdout ?? "");
  }
  const { base } = await changesBase(dir, baseRef);
  if (!base) return "";
  return (await tryGit(dir, ["diff", "--no-renames", base, "--", file.path])) ?? "";
}
