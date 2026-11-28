// Client-safe: the review card's shape, built on the server by lib/review/card.ts.
import type { ReviewEvidence } from "@/lib/evidence/types";
import type { WorkspacePrStatus } from "@/lib/projects/types";
import type { Criterion } from "@/lib/tasks/types";

export type ReviewTests = { state: "passed" | "failed" | "not_run"; command: string | null; detail: string };

/** The newest trial merge that included the task, as it concerns that task. */
export type ReviewIntegration = {
  id: string; workspaceId: string; branch: string | null; createdAt: string;
  /** This task's branches merged without conflicts. */
  merged: boolean;
  conflicts: { repo: string; files: string[] }[];
  tests: ReviewTests;
  /** A branch head has moved since the trial merge, so its result no longer describes the work. */
  outOfDate: boolean;
};

/** Everything the review card shows for one finished worker: its changes, trial merge and pull request. */
export type ReviewState = {
  taskId: string; taskTitle: string; sessionId: string; workspaceId: string; branch: string | null;
  changes: { files: number; additions: number; deletions: number } | null;
  integration: ReviewIntegration | null;
  pr: WorkspacePrStatus | null;
  /** The task's acceptance criteria, if it has any, and their current version. */
  criteria: Criterion[] | null;
  criteriaVersion: number;
  /** Newest first, each marked when it covers an older commit or older criteria. */
  evidence: ReviewEvidence[];
};

/** The summary line of a `<worker_report>` (its first line after the opening tag). */
export function reportSummary(content: string | null | undefined): string | null {
  if (!content) return null;
  const body = content.replace(/^<worker_report[^>]*>\n?/, "").replace(/\n?<\/worker_report>\s*$/, "");
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    if (/^(Needs person|Mode|Branch|Diff|Race|Cost|Overlaps|Workspace|Evidence):/.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").trim() || null;
}
