// Every git repo a workspace works in, as one flat list, so git features can loop over them.
import type { Project, Workspace } from "./types";

export type RepoTarget = {
  id: string;
  name: string;
  /** The repo's main checkout. */
  root: string;
  /** Where this workspace works on it: its worktree, or `root` when in place. */
  cwd: string;
  branch: string | null;
  worktreePath: string | null;
  baseRef: string | null;
  defaultBranch: string | null;
  remote: string | null;
};

type Context = { project: Project; workspace: Workspace };

/** Each git repo the workspace covers, in order. Plain folders have no git state and are left out. */
export function workspaceRepoTargets({ project, workspace }: Context): RepoTarget[] {
  return workspace.repos.flatMap((checkout) => {
    const repo = project.repos.find((r) => r.id === checkout.repoId);
    if (repo?.kind !== "repo") return [];
    return [{
      id: repo.id, name: checkout.name, root: repo.path, cwd: checkout.cwd,
      branch: checkout.branch, worktreePath: checkout.worktreePath, baseRef: checkout.baseRef,
      defaultBranch: repo.defaultBranch, remote: repo.remote,
    }];
  });
}

/** The target single-repo views describe: the checkout sessions run in, else the first git repo. */
export function anchorTarget(ctx: Context): RepoTarget | null {
  const targets = workspaceRepoTargets(ctx);
  return targets.find((t) => t.cwd === ctx.workspace.cwd) ?? targets[0] ?? null;
}

/** One target by id, or the anchor without one. */
export function findRepoTarget(ctx: Context, id?: string | null): RepoTarget | null {
  return id ? workspaceRepoTargets(ctx).find((t) => t.id === id) ?? null : anchorTarget(ctx);
}
