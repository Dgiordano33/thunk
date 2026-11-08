import type { PullRequestInfo, WorkspacePrStatus } from "./types";

export type WorkspaceDelivery = {
  workspaceId: string;
  projectId: string;
  status: WorkspacePrStatus;
  git: { ahead: number | null; behind: number | null; dirty: boolean } | null;
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
