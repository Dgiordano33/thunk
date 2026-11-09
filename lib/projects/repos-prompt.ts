// How agents learn about a workspace's other repos. Kept free of server-only imports so it is easy to test.
import type { Workspace } from "./types";

const otherRepos = (workspace: Workspace) => workspace.repos.filter((r) => r.cwd !== workspace.cwd);

/** Lines describing the repos besides the session's cwd; empty for single-repo workspaces. */
export function otherReposPrompt(workspace: Workspace) {
  const repos = otherRepos(workspace);
  if (!repos.length) return [];
  return [
    "",
    `This is a multi-repo workspace. Besides your cwd, it covers ${repos.length === 1 ? "one more repo" : `${repos.length} more repos`}, each with its own history. Work on them at these paths (use absolute paths or \`git -C <path>\`; commit in each repo separately):`,
    ...repos.map((r) =>
      r.worktreePath
        ? `- **${r.name}**: git worktree at \`${r.cwd}\` on branch \`${r.branch}\` (branched from \`${r.baseRef}\`). Do not switch branches or edit its main checkout.`
        : `- **${r.name}**: \`${r.cwd}\` (in place, no worktree).`,
    ),
    "Each of those repos' own CLAUDE.md/AGENTS.md is not loaded automatically; read it before making changes there.",
  ];
}

/** Directories the agent may use besides its cwd: each other repo's checkout. */
export function otherRepoDirectories(workspace: Workspace) {
  return otherRepos(workspace).map((r) => r.cwd);
}
