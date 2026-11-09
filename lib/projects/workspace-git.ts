import "server-only";
import { stat } from "node:fs/promises";
import { git, tryGit } from "./git";
import type { WorkspaceContext } from "./index";
import { workspaceRepoTargets, type RepoTarget } from "./repo-targets";

export type GitAction = "sync" | "rebase" | "merge" | "squash" | "merge-abort" | "rebase-abort" | "rebase-continue";

async function exists(cwd: string, name: string) {
  const file = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", name]);
  return Boolean(await stat(file).catch(() => null));
}

async function operation(cwd: string) {
  if (await exists(cwd, "rebase-merge") || await exists(cwd, "rebase-apply")) return "rebase" as const;
  if (await exists(cwd, "MERGE_HEAD")) return "merge" as const;
  return null;
}

const canManage = (t: RepoTarget) => Boolean(t.worktreePath && t.branch && t.defaultBranch);

async function repoGitState(t: RepoTarget) {
  const base = t.defaultBranch ? await baseRef(t) : null;
  const counts = base ? (await tryGit(t.cwd, ["rev-list", "--left-right", "--count", `${base}...HEAD`]))?.split(/\s+/).map(Number) : null;
  return {
    id: t.id, name: t.name,
    base, target: t.defaultBranch, canManage: canManage(t),
    ahead: counts?.[1] ?? 0, behind: counts?.[0] ?? 0,
    operation: await operation(t.cwd), rootOperation: await operation(t.root),
    conflicts: (await git(t.cwd, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean),
    rootConflicts: (await git(t.root, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean),
  };
}

export type RepoGitState = Awaited<ReturnType<typeof repoGitState>>;

/**
 * Git state of every repo in the workspace (`repos`). The top-level fields repeat the first repo's,
 * for single-repo callers.
 */
export async function workspaceGitState(ctx: WorkspaceContext) {
  const targets = workspaceRepoTargets(ctx);
  if (!targets.length) return null;
  const repos = await Promise.all(targets.map(repoGitState));
  return { ...repos[0], repos };
}

async function baseRef(t: RepoTarget) {
  const branch = t.defaultBranch;
  if (!branch) throw new Error(`${t.name ?? "Project"} has no default branch`);
  return await tryGit(t.cwd, ["rev-parse", "--verify", `refs/remotes/origin/${branch}`])
    ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
}

async function assertClean(cwd: string) {
  if (await operation(cwd)) throw new Error(`Finish or abort the Git operation in ${cwd} first`);
  if (await git(cwd, ["status", "--porcelain"])) throw new Error(`Commit or stash changes in ${cwd} first`);
}

export async function assertWorkspaceCanRemove(ctx: WorkspaceContext) {
  const targets = workspaceRepoTargets(ctx);
  for (const t of targets) {
    if (!t.worktreePath) continue;
    const where = targets.length > 1 ? ` in ${t.name}` : "";
    await assertClean(t.cwd);
    if (!t.defaultBranch) throw new Error(`Set a default branch${where} before deleting a worktree`);
    // A squash has different commit IDs, and the target may have moved on since. The work is merged
    // when merging HEAD into the target would change nothing.
    const target = `refs/heads/${t.defaultBranch}`;
    const ancestor = await tryGit(t.cwd, ["merge-base", "--is-ancestor", "HEAD", target]);
    const merged = ancestor !== null || await tryGit(t.cwd, ["merge-tree", "--write-tree", target, "HEAD"]) === await git(t.cwd, ["rev-parse", `${target}^{tree}`]);
    if (!merged) {
      throw new Error(`Workspace contains unmerged commits${where}. Merge back before deleting it; Archive keeps the worktree.`);
    }
  }
}

/** Checks one repo can take a sync/rebase/merge/squash, without changing anything. */
async function assertReady(t: RepoTarget, action: GitAction, multi: boolean) {
  const where = multi ? ` (${t.name})` : "";
  if (await git(t.cwd, ["branch", "--show-current"]) !== t.branch) throw new Error(`Workspace branch changed${where}; restore its original branch first`);
  await assertClean(t.cwd);
  if (action === "merge" || action === "squash") {
    await assertClean(t.root);
    if (await git(t.root, ["branch", "--show-current"]) !== t.defaultBranch) {
      throw new Error(`Check out ${t.defaultBranch} in ${t.root} before merging back`);
    }
  }
}

async function applyToRepo(t: RepoTarget, action: GitAction, label: string) {
  const defaultBranch = t.defaultBranch!;
  const branch = t.branch!;
  if (action === "merge-abort") {
    const cwd = await operation(t.root) === "merge" ? t.root : t.cwd;
    await git(cwd, ["merge", "--abort"]);
    return;
  }
  if (action === "rebase-abort" || action === "rebase-continue") {
    // Avoid opening an editor in the HTTP request.
    await git(t.cwd, ["-c", "core.editor=true", "rebase", action === "rebase-abort" ? "--abort" : "--continue"]);
    return;
  }
  if (action === "sync" || action === "rebase") {
    if (await tryGit(t.root, ["remote", "get-url", "origin"])) {
      await git(t.root, ["fetch", "origin", defaultBranch]);
    }
    const base = await baseRef(t);
    await git(t.cwd, action === "sync" ? ["merge", "--no-edit", base] : ["rebase", base]);
    return;
  }
  if (action === "merge") {
    await git(t.root, ["merge", "--no-edit", "--", branch]);
  } else {
    try {
      await git(t.root, ["merge", "--squash", "--", branch]);
      if (await git(t.root, ["diff", "--cached", "--name-only"])) {
        await git(t.root, ["commit", "-m", `Merge workspace ${label}`]);
      }
    } catch (err) {
      // The target was clean: restore it if squashing or its commit hook fails; source commits stay intact.
      await git(t.root, ["reset", "--merge", "HEAD"]);
      throw err;
    }
  }
}

/**
 * Run a git action across the workspace's repos. With `repoId`, only that repo. Otherwise
 * sync/rebase/merge/squash apply to every branch repo (all are checked first, so a dirty repo stops
 * the action before anything changes), and abort/continue apply to each repo with that operation open.
 */
export async function workspaceGitAction(ctx: WorkspaceContext, action: GitAction, repoId?: string | null) {
  const all = workspaceRepoTargets(ctx).filter(canManage);
  const targets = repoId ? all.filter((t) => t.id === repoId) : all;
  if (!targets.length) throw new Error("This action requires a branch workspace with a default branch");

  if (action === "merge-abort" || action === "rebase-abort" || action === "rebase-continue") {
    const want = action === "merge-abort" ? "merge" : "rebase";
    const open = [];
    for (const t of targets) {
      const ops = [await operation(t.cwd), ...(want === "merge" ? [await operation(t.root)] : [])];
      if (ops.includes(want)) open.push(t);
    }
    // Single-repo callers may ask without an operation open; let git report what's wrong.
    for (const t of open.length ? open : targets.slice(0, 1)) await applyToRepo(t, action, ctx.workspace.name);
    return;
  }

  for (const t of targets) await assertReady(t, action, targets.length > 1);
  for (const t of targets) {
    try {
      await applyToRepo(t, action, ctx.workspace.name);
    } catch (err) {
      if (targets.length === 1) throw err;
      throw new Error(`${t.name}: ${(err as Error).message}`);
    }
  }
}
