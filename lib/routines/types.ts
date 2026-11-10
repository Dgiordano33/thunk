// Shared between server and client. Keep free of server-only imports.
import type { ChangedFile } from "@/lib/projects/types";

/** Where a run happens: an existing workspace, or a fresh worktree created per run. */
export type RoutineTargetKind = "workspace" | "ephemeral";

export const DELIVERY_ROUTINE_EVENTS = ["ci_failed", "review_requested", "deploy_ready"] as const;
export const ROUTINE_EVENTS = ["pr_opened", "run_failed", ...DELIVERY_ROUTINE_EVENTS] as const;
export type RoutineEvent = (typeof ROUTINE_EVENTS)[number];

export const RUN_TRIGGERS = ["manual", "cron", "webhook", ...ROUTINE_EVENTS] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const RUN_STATUSES = ["queued", "running", "needs_attention", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses a run can still leave on its own. */
export const OPEN_RUN_STATUSES: readonly RunStatus[] = ["queued", "running", "needs_attention"];

export type RoutineCatchUp = "skip" | "once";

export type RoutineTriggerState = {
  delivery?: { epoch: string; seq: number; config: string } | null;
  /** Newest PR createdAt seen by the poller; PRs at or before it never fire. */
  prSeenAt?: string;
  /** PR numbers already fired for (capped). */
  prSeen?: (string | number)[];
};

export type Routine = {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  model: string;
  permissionMode: string;
  targetKind: RoutineTargetKind;
  targetWorkspaceId: string | null;
  scheduleCron: string | null;
  scheduleTz: string | null;
  events: RoutineEvent[];
  /** Null when the webhook is disabled. */
  webhookToken: string | null;
  enabled: boolean;
  catchUp: RoutineCatchUp;
  maxRunsPerDay: number;
  maxRunMinutes: number;
  triggerState: RoutineTriggerState;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunDiffStat = { files: number; additions: number; deletions: number; paths: Pick<ChangedFile, "path" | "status">[] };

export type RoutineRun = {
  id: string;
  routineId: string;
  sessionId: string | null;
  workspaceId: string | null;
  triggerSource: RunTrigger;
  triggerPayload: unknown;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  summary: string | null;
  diffStat: RunDiffStat | null;
  prUrl: string | null;
  noteId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoutineSummary = Routine & {
  projectName: string;
  lastRun: RoutineRun | null;
  activeRun: RoutineRun | null;
  runsToday: number;
};

/** A finished or open run with enough context to show in ambient lists. */
export type RoutineRunActivity = RoutineRun & { routineName: string; projectId: string; projectName: string };

/** `trigger` is absent on sessions persisted before it was recorded. */
export type { SessionOrigin } from "@/lib/agent/types";

export const ROUTINE_SCHEDULE_PRESETS = [
  { id: "none", label: "No schedule", cron: null },
  { id: "hourly", label: "Every hour", cron: "0 * * * *" },
  { id: "6h", label: "Every 6 hours", cron: "0 */6 * * *" },
  { id: "daily", label: "Daily at 09:00", cron: "0 9 * * *" },
  { id: "weekdays", label: "Weekdays at 09:00", cron: "0 9 * * 1-5" },
  { id: "weekly", label: "Mondays at 09:00", cron: "0 9 * * 1" },
  { id: "custom", label: "Custom cron…", cron: null },
] as const;

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  needs_attention: "Needs you",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = {
  manual: "Run now",
  cron: "Schedule",
  webhook: "Webhook",
  pr_opened: "New PR",
  run_failed: "Run script failed",
  ci_failed: "CI failed",
  review_requested: "Review requested",
  deploy_ready: "Deploy ready",
};

export const EVENT_LABELS: Record<RoutineEvent, string> = {
  pr_opened: "New pull request",
  run_failed: "Run script fails",
  ci_failed: "CI fails",
  review_requested: "A review is requested",
  deploy_ready: "A deployment is ready",
};

export const MAX_CONCURRENT_RUNS = 3;

export const routineSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "routine";
