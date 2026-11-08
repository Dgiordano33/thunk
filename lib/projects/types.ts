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
  /** Repos the project spans besides its primary root, in the order they were added. */
  extraRepos: ProjectRepo[];
  createdAt: string;
  updatedAt: string;
};

/** An additional git repo in a multi-repo project. The primary repo is the project's own root. */
export type ProjectRepo = {
  id: string;
  projectId: string;
  /** Short label, unique within the project; defaults to the checkout's folder name. */
  name: string;
  /** Absolute path of the repo's main checkout (its git toplevel). */
  path: string;
  remote: string | null;
  defaultBranch: string | null;
  createdAt: string;
};

/** Where a workspace works on one of the project's additional repos. */
export type WorkspaceRepo = {
  repoId: string;
  name: string;
  /** The worktree when one exists, else the repo's main checkout (in place). */
  cwd: string;
  branch: string | null;
  worktreePath: string | null;
  baseRef: string | null;
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
  /** The additional repos this workspace covers (a subset of the project's), each with its own checkout. */
  extraRepos: WorkspaceRepo[];
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSummary = Workspace & { sessionCount: number };
export type ProjectSummary = Project & { workspaceCount: number; sessionCount: number; lastActivityAt: string | null };

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

export type CheckState = "pass" | "fail" | "pending" | "skipped";

export type PrCheck = { name: string; state: CheckState; url: string | null };

export type PrReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

export type PullRequestInfo = {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  isDraft: boolean;
  /** Latest run of each check and commit status on the head commit. */
  checks: PrCheck[];
  reviewDecision: PrReviewDecision;
  /** GitHub computes this lazily; UNKNOWN right after a push. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** CLEAN, BEHIND, BLOCKED, DIRTY, DRAFT, UNSTABLE, HAS_HOOKS or UNKNOWN. */
  mergeStateStatus: string;
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
