import "server-only";
import { stat } from "node:fs/promises";
import { git, tryGit } from "./git";
import type { WorkspaceContext } from "./index";

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

export async function workspaceGitState(ctx: WorkspaceContext) {
  if (ctx.project.kind !== "repo") return null;
  const { workspace: ws, project } = ctx;
  const base = await baseRef(ctx);
  const counts = (await tryGit(ws.cwd, ["rev-list", "--left-right", "--count", `${base}...HEAD`]))?.split(/\s+/).map(Number);
  return {
    base, target: project.defaultBranch, canManage: Boolean(ws.worktreePath && ws.branch && project.defaultBranch),
    ahead: counts?.[1] ?? 0, behind: counts?.[0] ?? 0,
    operation: await operation(ws.cwd), rootOperation: await operation(project.root),
    conflicts: (await git(ws.cwd, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean),
    rootConflicts: (await git(project.root, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean),
  };
}

async function baseRef(ctx: WorkspaceContext) {
  const branch = ctx.project.defaultBranch;
  if (!branch) throw new Error("Project has no default branch");
  return await tryGit(ctx.workspace.cwd, ["rev-parse", "--verify", `refs/remotes/origin/${branch}`])
    ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
}

async function assertClean(cwd: string) {
  if (await operation(cwd)) throw new Error(`Finish or abort the Git operation in ${cwd} first`);
  if (await git(cwd, ["status", "--porcelain"])) throw new Error(`Commit or stash changes in ${cwd} first`);
}

export async function assertWorkspaceCanRemove(ctx: WorkspaceContext) {
  const { workspace: ws, project } = ctx;
  if (!ws.worktreePath) return;
  await assertClean(ws.cwd);
  if (!project.defaultBranch) throw new Error("Set a default branch before deleting a worktree");
  // A squash has different commit IDs; compare trees too so a successful squash can be cleaned up.
  const target = `refs/heads/${project.defaultBranch}`;
  const ancestor = await tryGit(ws.cwd, ["merge-base", "--is-ancestor", "HEAD", target]);
  if (ancestor === null && await git(ws.cwd, ["diff", target, "HEAD", "--"])) {
    throw new Error("Workspace contains unmerged commits. Merge back before deleting it; Archive keeps the worktree.");
  }
}

export async function workspaceGitAction(ctx: WorkspaceContext, action: GitAction) {
  const { workspace: ws, project } = ctx;
  if (!ws.worktreePath || !ws.branch || !project.defaultBranch) throw new Error("This action requires a branch workspace with a default branch");
  if (action === "merge-abort") {
    const cwd = await operation(project.root) === "merge" ? project.root : ws.cwd;
    await git(cwd, ["merge", "--abort"]);
    return;
  }
  if (action === "rebase-abort" || action === "rebase-continue") {
    // Avoid opening an editor in the HTTP request.
    await git(ws.cwd, ["-c", "core.editor=true", "rebase", action === "rebase-abort" ? "--abort" : "--continue"]);
    return;
  }
  if (await git(ws.cwd, ["branch", "--show-current"]) !== ws.branch) throw new Error("Workspace branch changed; restore its original branch first");
  await assertClean(ws.cwd);
  if (action === "sync" || action === "rebase") {
    if (await tryGit(project.root, ["remote", "get-url", "origin"])) {
      await git(project.root, ["fetch", "origin", project.defaultBranch]);
    }
    const base = await baseRef(ctx);
    await git(ws.cwd, action === "sync" ? ["merge", "--no-edit", base] : ["rebase", base]);
    return;
  }
  await assertClean(project.root);
  if (await git(project.root, ["branch", "--show-current"]) !== project.defaultBranch) {
    throw new Error(`Check out ${project.defaultBranch} in the project root before merging back`);
  }
  if (action === "merge") {
    await git(project.root, ["merge", "--no-edit", "--", ws.branch]);
  } else {
    try {
      await git(project.root, ["merge", "--squash", "--", ws.branch]);
      if (await git(project.root, ["diff", "--cached", "--name-only"])) {
        await git(project.root, ["commit", "-m", `Merge workspace ${ws.name}`]);
      }
    } catch (err) {
      // The target was clean: restore it if squashing or its commit hook fails; source commits stay intact.
      await git(project.root, ["reset", "--merge", "HEAD"]);
      throw err;
    }
  }
}
