// Which repo a workspace is anchored to. Shared between server and client: keep free of server-only imports.
import type { Project, ProjectRepo, Workspace } from "./types";

type Context = { project: Project; workspace: Workspace };

/** The project's git repos, leaving out plain folders. */
export const gitRepos = (project: Pick<Project, "repos">) => project.repos.filter((r) => r.kind === "repo");

/** The repo whose checkout sessions run in; a home-directory workspace has none. */
export function anchorRepo({ project, workspace }: Context): ProjectRepo | null {
  const checkout = workspace.repos.find((r) => r.cwd === workspace.cwd) ?? workspace.repos[0];
  return project.repos.find((r) => r.id === checkout?.repoId) ?? null;
}

/** Where trusted project config comes from: the anchor repo's main checkout, else the session directory. */
export function sessionConfigRoot(ctx: Context) {
  return anchorRepo(ctx)?.path ?? ctx.workspace.cwd;
}
