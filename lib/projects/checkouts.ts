import "server-only";
import { stat } from "node:fs/promises";
import { createWorktree, git, refreshBase, tryGit } from "./git";
import { workspaceRepoTargets, type RepoTarget } from "./repo-targets";
import { prepareWorkspace, stopWorkspaceProcesses, withWorkspaceLock } from "./runtime";
import type { Project, Workspace } from "./types";

// A workspace's worktrees can be released while it sits idle and restored when work resumes. The
// workspace row, its sessions, notes and memory stay put, and restored worktrees reuse the same paths,
// so Claude transcripts (stored per cwd) still resume.

type Context = { project: Project; workspace: Workspace };
type Worktree = RepoTarget & { worktreePath: string; branch: string };

const exists = (p: string) => stat(p).then(() => true, () => false);
const worktrees = (ctx: Context) =>
  (ctx.workspace.repos ? workspaceRepoTargets(ctx) : []).filter((t): t is Worktree => Boolean(t.worktreePath && t.branch));

/** Whether any of the workspace's worktrees is off disk. */
export async function checkoutsReleased(ctx: Context) {
  for (const t of worktrees(ctx)) if (!(await exists(t.worktreePath))) return true;
  return false;
}

/** Clean, and every commit on the branch is already in its base or default branch: removing it loses nothing. */
async function disposable(t: Worktree) {
  if (await tryGit(t.worktreePath, ["status", "--porcelain"]) !== "") return false;
  const refs = [t.baseRef, t.defaultBranch && `refs/heads/${t.defaultBranch}`, t.defaultBranch && `refs/remotes/origin/${t.defaultBranch}`];
  for (const ref of refs) if (ref && await tryGit(t.worktreePath, ["merge-base", "--is-ancestor", "HEAD", ref]) !== null) return true;
  return false;
}

/**
 * Remove the workspace's worktrees and branches when none holds work (see disposable). Returns false,
 * changing nothing, otherwise or when they are already released.
 */
export async function releaseCheckouts(ctx: Context) {
  return withWorkspaceLock(ctx.workspace.id, async () => {
    const targets = worktrees(ctx);
    if (!targets.length || await checkoutsReleased(ctx)) return false;
    for (const t of targets) if (!(await disposable(t))) return false;
    await stopWorkspaceProcesses(ctx.workspace.id);
    for (const t of targets) {
      await git(t.root, ["worktree", "remove", t.worktreePath]);
      await tryGit(t.root, ["branch", "-D", t.branch]);
    }
    return true;
  }, { wait: true });
}

/**
 * Recreate released worktrees at their old paths, branching from the freshly fetched base,
 * then rerun setup in the background. Returns whether anything was restored.
 */
export async function restoreCheckouts(ctx: Context) {
  if (!(await checkoutsReleased(ctx))) return false;
  await withWorkspaceLock(ctx.workspace.id, async () => {
    for (const t of worktrees(ctx)) {
      if (await exists(t.worktreePath)) continue;
      await refreshBase(t.root, t.defaultBranch);
      await tryGit(t.root, ["worktree", "prune"]);
      await createWorktree({ root: t.root, path: t.worktreePath, branch: t.branch, baseRef: t.baseRef ?? "HEAD" });
    }
  }, { wait: true });
  void prepareWorkspace(ctx).catch((err) => console.error("[thunk] workspace setup", err));
  return true;
}

/**
 * Bring clean worktrees with no commits of their own up to their base, so long-lived workspaces
 * (a canvas) don't run against old code. Worktrees with any work on them are left as they are.
 */
export async function fastForwardCheckouts(ctx: Context) {
  for (const t of worktrees(ctx)) {
    if (!t.baseRef || !(await exists(t.worktreePath))) continue;
    await refreshBase(t.root, t.defaultBranch);
    if (await tryGit(t.worktreePath, ["status", "--porcelain"]) !== "") continue;
    if (await tryGit(t.worktreePath, ["rev-list", "--count", `${t.baseRef}..HEAD`]) !== "0") continue;
    await tryGit(t.worktreePath, ["merge", "--ff-only", "--quiet", t.baseRef]);
  }
}
