import { CLAUDE_MODELS, type ModelOption } from "@/lib/agent/types";
import type { Workspace } from "@/lib/projects/types";

export const MODE_LABELS: Record<string, string> = {
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan mode",
  bypassPermissions: "Bypass permissions",
  dontAsk: "Don't ask",
  auto: "Auto",
};

export function modelLabel(id: string, models: ModelOption[] = CLAUDE_MODELS) {
  return models.find((m) => m.id === id)?.label ?? id;
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** The workspace every project gets automatically: works in the repo folder itself, no worktree. */
export function isLocalWorkspace(w: Pick<Workspace, "slug" | "branch">) {
  return w.slug === "main" && !w.branch;
}

export function workspaceLabel(w: Pick<Workspace, "slug" | "branch" | "name">) {
  return w.name;
}

/** What to show in lists: the branch for worktrees (like Conductor), else the label. */
export function workspaceDisplayName(w: Pick<Workspace, "slug" | "name" | "branch">) {
  return w.branch ?? workspaceLabel(w);
}

export const STATUS_LABELS: Record<string, string> = {
  starting: "Starting", idle: "Ready", running: "Working", awaiting: "Needs you",
  closed: "Closed", error: "Error",
};
export const CONNECTION_LABELS = { connecting: "Connecting", open: "Connected", reconnecting: "Reconnecting", not_live: "Paused" };
export function sessionStatus(session: { live: boolean; status: string; waitingOn?: string | null }) {
  return !session.live ? "Paused" : session.status === "awaiting" && session.waitingOn === "chief" ? "Asking the chief" : STATUS_LABELS[session.status] ?? session.status;
}
export function sessionDot(session: { live: boolean; status: string }) {
  if (!session.live) return "bg-muted-foreground/40";
  if (session.status === "awaiting") return "bg-[var(--status-attention)]";
  if (session.status === "error") return "bg-[var(--status-error)]";
  return session.status === "running" ? "motion-safe:animate-pulse bg-[var(--status-running)]" : "bg-[var(--status-ok)]";
}
