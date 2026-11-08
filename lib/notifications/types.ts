export const NOTIFICATION_KINDS = [
  "permission", "question", "plan", "turn_finished", "turn_failed", "session_error", "session_stuck",
  "run_needs_attention", "run_succeeded", "run_failed", "ci_failed", "ci_stuck", "review_requested",
  "deploy_ready", "pr_merged", "script_failed", "agent_request",
] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];
export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  permission: "Permission", question: "Question", plan: "Plan ready", turn_finished: "Turn finished",
  turn_failed: "Turn failed", session_error: "Session error", session_stuck: "Session stuck",
  run_needs_attention: "Run needs attention", run_succeeded: "Run succeeded", run_failed: "Run failed",
  ci_failed: "CI failed", ci_stuck: "CI stuck", review_requested: "Review requested", deploy_ready: "Deploy ready",
  pr_merged: "PR merged", script_failed: "Script failed", agent_request: "Agent request",
};
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
