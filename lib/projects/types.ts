// Shared between server and client. Keep free of server-only imports.

export type ProjectRepoKind = "repo" | "folder";

export type Project = {
  id: string;
  name: string;
  /** Immutable name of the project's directory under ~/.thunk/projects/. */
  dataKey: string;
  /** URL slug: the project lives at `/{slug}`. Unique, never a reserved route, kept across renames. */
  slug: string;
  /** Every repo and folder the project spans, in the order they were added. May be empty. */
  repos: ProjectRepo[];
  repoFolders: RepoFolder[];
  createdAt: string;
  updatedAt: string;
};

export type RepoFolder = {
  id: string; projectId: string; repoId: string; path: string; label: string;
  /** Note ids (file names without `.md`) the notebook shows; null shows every Markdown file in the folder. */
  files: string[] | null;
};

export type ProjectRepo = {
  id: string;
  projectId: string;
  /** Short label, unique within the project; defaults to the checkout's folder name. */
  name: string;
  /** Absolute path of the repo's main checkout (its git toplevel), or of the plain folder. */
  path: string;
  kind: ProjectRepoKind;
  remote: string | null;
  defaultBranch: string | null;
  createdAt: string;
};

/** Where a workspace works on one of the project's repos. */
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
  /** Where sessions run: the first repo's checkout, or the project's home directory when it has none. */
  cwd: string;
  /** The branch shared by this workspace's worktrees; null when it works in place. */
  branch: string | null;
  /** The repos this workspace covers (a subset of the project's), each with its own checkout. */
  repos: WorkspaceRepo[];
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
};

/** A top-level directory in the workspace file browser: one repo or folder checkout. */
export type FileRoot = {
  /** The repo id, or "workspace" when the workspace has no repos and the root is its cwd. */
  id: string;
  name: string;
  cwd: string;
  git: boolean;
  /** The repo single-repo change views describe (see `anchorTarget`). */
  anchor: boolean;
};

export type FileEntry = { name: string; path: string; kind: "dir" | "file"; ignored: boolean };

/** A file opened in the editor. Binary and oversized files carry no content. */
export type FileContent =
  | { kind: "text"; content: string; version: string }
  | { kind: "binary" | "too-large"; size: number; version: string };

export type WorkspaceSummary = Workspace & { sessionCount: number };
export type ProjectSummary = Project & { workspaceCount: number; sessionCount: number; lastActivityAt: string | null };

export type ChangedFile = {
  mtimeMs?: number;
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

/** One repo's changes in a multi-repo workspace. */
export type RepoChanges = {
  id: string;
  name: string;
  cwd: string;
  changes: WorkspaceChanges | null;
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
