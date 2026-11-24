export const NOTIFICATION_KINDS = [
  "capture_ready", "worker_report", "delegation_plan", "permission", "question", "plan", "turn_finished", "turn_failed", "session_error", "session_stuck",
  "run_needs_attention", "run_succeeded", "run_failed", "ci_failed", "ci_stuck", "review_requested",
  "deploy_ready", "pr_merged", "script_failed", "agent_request",
] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];
export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  capture_ready: "Thought ready", worker_report: "Worker report", delegation_plan: "Chief plan", permission: "Permission", question: "Question", plan: "Plan ready", turn_finished: "Turn finished",
  turn_failed: "Turn failed", session_error: "Session error", session_stuck: "Session stuck",
  run_needs_attention: "Run needs attention", run_succeeded: "Run succeeded", run_failed: "Run failed",
  ci_failed: "CI failed", ci_stuck: "CI stuck", review_requested: "Review requested", deploy_ready: "Deploy ready",
  pr_merged: "PR merged", script_failed: "Script failed", agent_request: "Agent request",
};
/** Settings → Notifications shows the kinds in these groups. Every kind appears in exactly one. */
export const NOTIFICATION_GROUPS: { label: string; description: string; kinds: NotificationKind[] }[] = [
  { label: "Needs you", description: "An agent is waiting on an answer or approval.", kinds: ["capture_ready", "permission", "question", "plan", "delegation_plan", "agent_request", "review_requested"] },
  { label: "Sessions", description: "Turns finishing, failing or getting stuck.", kinds: ["turn_finished", "turn_failed", "session_error", "session_stuck", "worker_report"] },
  { label: "Routines", description: "Scheduled and triggered runs.", kinds: ["run_needs_attention", "run_succeeded", "run_failed"] },
  { label: "Delivery", description: "CI, pull requests, deploys and scripts.", kinds: ["ci_failed", "ci_stuck", "pr_merged", "deploy_ready", "script_failed"] },
];

/** Sent to Slack until you choose otherwise: the kinds where an agent is waiting on you. */
export const DEFAULT_SLACK_KINDS: readonly NotificationKind[] = NOTIFICATION_GROUPS[0].kinds;

export type Notification = {
  id: string; kind: NotificationKind; urgency: "action" | "info";
  projectId: string; workspaceId: string | null; sessionId: string | null; runId: string | null;
  subjectKey: string; title: string; detail: string | null; href: string;
  actions: { label: string; method: "POST"; path: string; body?: unknown }[];
  status: "open" | "resolved" | "dismissed";
  readAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
};
export type NewNotification = Pick<Notification, "kind" | "urgency" | "projectId" | "subjectKey" | "title" | "href"> & Partial<Pick<Notification, "workspaceId" | "sessionId" | "runId" | "detail" | "actions">>;
export type NotificationCounts = { total: number; action: number; byProject: Record<string, number> };
export type NotificationEvent = { kind: "opened" | "updated"; notification: Notification };
