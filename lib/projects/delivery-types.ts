import type { PullRequestInfo, WorkspacePrStatus } from "./types";

type GitState = { ahead: number | null; behind: number | null; dirty: boolean };

/** Branch, local changes and PR for one git repo of a workspace. */
export type RepoDelivery = {
  repoId: string;
  name: string;
  /** False when the workspace works in the repo's main checkout. */
  worktree: boolean;
  status: WorkspacePrStatus;
  git: GitState;
  deployedPreviewUrl: string | null;
};

export type WorkspaceDelivery = {
  activity: DeliveryEvent[];
  workspaceId: string;
  projectId: string;
  /** Every git repo the workspace covers. `status`, `git` and `deployedPreviewUrl` below repeat the anchor repo's. */
  repos: RepoDelivery[];
  status: WorkspacePrStatus;
  git: GitState | null;
  running: boolean;
  localPreviewUrl: string | null;
  deployedPreviewUrl: string | null;
  updatedAt: string | null;
  error: string | null;
};

export function deliveryCue(pr: PullRequestInfo | null) {
  if (!pr) return null;
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY" || pr.checks.some((c) => c.state === "fail"))
    return { label: "Failing checks or conflicts", symbol: "×", color: "#b93434", kind: "fail" };
  if (pr.isDraft) return { label: "Draft PR", symbol: "–", color: "#737373", kind: "draft" };
  if (pr.checks.some((c) => c.state === "pending"))
    return { label: "Checks running", symbol: "…", color: "#986000", kind: "pending" };
  if (pr.checks.some((c) => c.state === "pass"))
    return { label: "Checks passed", symbol: "✓", color: "#277443", kind: "pass" };
  return { label: "No checks reported or all skipped", symbol: "?", color: "#737373", kind: "unknown" };
}

export function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export const DELIVERY_EVENT_TYPES = ["ci_passed", "ci_failed", "review_posted", "review_requested", "deploy_ready", "pr_merged"] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];
export const DELIVERY_EVENT_LABELS: Record<DeliveryEventType, string> = {
  ci_passed: "CI passed", ci_failed: "CI failed", review_posted: "Review posted",
  review_requested: "Review requested", deploy_ready: "Deploy ready", pr_merged: "PR merged",
};
export type DeliveryEvent = {
  id: string;
  seq: number;
  type: DeliveryEventType;
  at: string;
  branch: string;
  pr: { number: number; url: string; title: string; head: string };
  checks: { name: string; state: string; url: string | null }[];
  previewUrl: string | null;
};
