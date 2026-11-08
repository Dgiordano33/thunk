// How agents learn about a workspace's extra repos. Kept free of server-only imports so it is easy to test.
import type { Workspace } from "./types";

/** Lines describing the workspace's other repos; empty for single-repo workspaces. */
export function extraReposPrompt(workspace: Workspace) {
  const repos = workspace.extraRepos ?? [];
  if (!repos.length) return [];
  return [
    "",
    `This is a multi-repo workspace. Besides your cwd, it covers ${repos.length === 1 ? "one more git repo" : `${repos.length} more git repos`}, each its own repository with its own history. Work on them at these paths (use absolute paths or \`git -C <path>\`; commit in each repo separately):`,
    ...repos.map((r) =>
      r.worktreePath
        ? `- **${r.name}**: git worktree at \`${r.cwd}\` on branch \`${r.branch}\` (branched from \`${r.baseRef}\`). Do not switch branches or edit its main checkout.`
        : `- **${r.name}**: \`${r.cwd}\` (in place, no worktree).`,
    ),
    "Each of those repos' own CLAUDE.md/AGENTS.md is not loaded automatically; read it before making changes there.",
  ];
}

/** Directories the agent may use besides its cwd: each extra repo checkout. */
export function extraRepoDirectories(workspace: Workspace) {
  return (workspace.extraRepos ?? []).map((r) => r.cwd);
}
