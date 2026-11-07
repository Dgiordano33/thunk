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
export function isLocalWorkspace(w: Pick<Workspace, "slug" | "worktreePath">) {
  return w.slug === "main" && !w.worktreePath;
}

export function workspaceLabel(w: Pick<Workspace, "slug" | "worktreePath" | "name">) {
  return isLocalWorkspace(w) ? "Local" : w.name;
}

/** What to show in lists: the branch for worktrees (like Conductor), else the label. */
export function workspaceDisplayName(w: Pick<Workspace, "slug" | "worktreePath" | "name" | "branch">) {
  return w.worktreePath && w.branch ? w.branch : workspaceLabel(w);
}
