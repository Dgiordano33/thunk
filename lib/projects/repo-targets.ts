// Every git repo a workspace works in, as one flat list, so git features can loop over them.
import type { Project, Workspace } from "./types";

/** Id of the project's primary repo in a RepoTarget list; extra repos use their project_repos id. */
export const PRIMARY_REPO = "primary";

export type RepoTarget = {
  id: string;
  name: string;
  primary: boolean;
  /** The repo's main checkout. */
  root: string;
  /** Where this workspace works on it: its worktree, or `root` when in place. */
  cwd: string;
  branch: string | null;
  worktreePath: string | null;
  baseRef: string | null;
  defaultBranch: string | null;
};

/** The primary repo first (when the project root is a repo), then each extra repo the workspace covers. */
export function workspaceRepoTargets(ctx: { project: Project; workspace: Workspace }): RepoTarget[] {
  const { project, workspace: ws } = ctx;
  const targets: RepoTarget[] = [];
  if (project.kind === "repo") {
    targets.push({
      id: PRIMARY_REPO, name: project.name, primary: true, root: project.root, cwd: ws.cwd,
      branch: ws.branch, worktreePath: ws.worktreePath, baseRef: ws.baseRef, defaultBranch: project.defaultBranch,
    });
  }
  for (const checkout of ws.extraRepos ?? []) {
    const repo = project.extraRepos?.find((r) => r.id === checkout.repoId);
    if (!repo) continue;
    targets.push({
      id: repo.id, name: checkout.name, primary: false, root: repo.path, cwd: checkout.cwd,
      branch: checkout.branch, worktreePath: checkout.worktreePath, baseRef: checkout.baseRef, defaultBranch: repo.defaultBranch,
    });
  }
  return targets;
}

/** One target by id (default: the first, i.e. the primary repo when there is one). */
export function findRepoTarget(ctx: { project: Project; workspace: Workspace }, id?: string | null): RepoTarget | null {
  const targets = workspaceRepoTargets(ctx);
  return (id ? targets.find((t) => t.id === id) : targets[0]) ?? null;
}
