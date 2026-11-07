// Shared between server and client. Keep free of server-only imports.

export type ProjectKind = "repo" | "folder";

export type Project = {
  id: string;
  name: string;
  /** Absolute path: the git toplevel for repos, the folder itself otherwise. */
  root: string;
  kind: ProjectKind;
  remote: string | null;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceStatus = "active" | "archived";

export type Workspace = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  /** Where sessions run: the worktree when one exists, else the project root. */
  cwd: string;
  branch: string | null;
  worktreePath: string | null;
  baseRef: string | null;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSummary = Workspace & { sessionCount: number; lastSessionAt: string | null };
export type ProjectSummary = Project & { workspaceCount: number; lastActivityAt: string | null };

export type ChangedFile = {
  path: string;
  /** git name-status letter: A, M, D, R…; "U" for untracked. */
  status: string;
  additions: number;
  deletions: number;
};

export type WorkspaceChanges = {
  /** What the changes are measured against: the merge-base with the workspace's base ref, else HEAD. */
  base: string | null;
  baseLabel: string;
  files: ChangedFile[];
  additions: number;
  deletions: number;
};

export type PullRequestInfo = {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  isDraft: boolean;
};

export type WorkspacePrStatus = {
  branch: string | null;
  /** Branch the PR targets. */
  base: string;
  pr: PullRequestInfo | null;
  canCreate: boolean;
  /** Why a PR can't be created, when it can't. */
  reason: string | null;
};
