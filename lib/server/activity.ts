import type { ProcessKind } from "@/lib/projects/runtime-types";
import type { SessionState } from "@/lib/agent/types";

/** What this server is doing right now; read by `thunk autoupdate` before it restarts (docs/server.md). */
export type ServerActivity = {
  /** True when a restart would cut off work: an agent turn, a routine run, or a workspace setup/archive. */
  busy: boolean;
  /** Human-readable reasons behind `busy`, for the deploy log. */
  reasons: string[];
  agentsRunning: number;
  /** Agents waiting on an answer or permission. They resume after a restart, so they do not block it. */
  agentsAwaiting: number;
  routineRuns: number;
  workspaceTasks: number;
  /** Open terminals and dev-server previews. They are restarted by hand, so they do not block. */
  terminals: number;
  previews: number;
};

export type ActivityInput = {
  sessions: { status: SessionState }[];
  routineRuns: number;
  processes: { kind: ProcessKind; running: boolean }[];
  /** Workspaces holding the operation lock (setup, archive, checkpoint). */
  workspaceLocks: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarizeActivity({ sessions, routineRuns, processes, workspaceLocks }: ActivityInput): ServerActivity {
  const running = processes.filter((p) => p.running);
  const count = (kind: ProcessKind) => running.filter((p) => p.kind === kind).length;
  const agentsRunning = sessions.filter((s) => s.status === "running" || s.status === "starting").length;
  const agentsAwaiting = sessions.filter((s) => s.status === "awaiting").length;
  const workspaceTasks = Math.max(workspaceLocks, count("setup") + count("archive"));
  const reasons = [
    agentsRunning && `${plural(agentsRunning, "agent")} working`,
    routineRuns && `${plural(routineRuns, "routine run")} in progress`,
    workspaceTasks && `${plural(workspaceTasks, "workspace task")} running`,
  ].filter((r): r is string => Boolean(r));
  return {
    busy: reasons.length > 0,
    reasons,
    agentsRunning,
    agentsAwaiting,
    routineRuns,
    workspaceTasks,
    terminals: count("shell"),
    previews: count("run"),
  };
}
