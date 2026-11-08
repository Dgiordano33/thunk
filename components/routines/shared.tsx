"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client/api";
import { describeCron } from "@/lib/routines/cron";
import { EVENT_LABELS, RUN_STATUS_LABELS, type Routine, type RoutineRun, type RoutineSummary, type RunStatus } from "@/lib/routines/types";
import { cn } from "@/lib/utils";

export const STATUS_STYLE: Record<RunStatus, { badge: string; dot: string }> = {
  queued: { badge: "text-muted-foreground", dot: "bg-muted-foreground/60" },
  running: { badge: "border-amber-500/40 text-amber-700 dark:text-amber-400", dot: "animate-pulse bg-amber-500" },
  needs_attention: { badge: "border-amber-500/50 text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  succeeded: { badge: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  failed: { badge: "border-red-500/40 text-red-700 dark:text-red-400", dot: "bg-red-500" },
  cancelled: { badge: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

export const isSkipRun = (run: Pick<RoutineRun, "status" | "error">) => run.status === "cancelled" && Boolean(run.error?.startsWith("Skipped"));

export function RunStatusBadge({ run, className }: { run: Pick<RoutineRun, "status" | "error">; className?: string }) {
  const style = STATUS_STYLE[run.status];
  return (
    <Badge variant="outline" className={cn("h-5 gap-1.5 text-[11px]", style.badge, className)} title={run.error ?? undefined}>
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {isSkipRun(run) ? "Skipped" : RUN_STATUS_LABELS[run.status]}
    </Badge>
  );
}

/** "Weekdays 09:00 · New PR · webhook", or "Manual only". */
export function triggerSummary(r: Pick<Routine, "scheduleCron" | "events" | "webhookToken">) {
  const parts = [
    ...(r.scheduleCron ? [describeCron(r.scheduleCron)] : []),
    ...r.events.map((e) => EVENT_LABELS[e]),
    ...(r.webhookToken ? ["Webhook"] : []),
  ];
  return parts.length ? parts.join(" · ") : "Manual only";
}

export const usd = (n: number) => `$${n.toFixed(n > 0 && n < 1 ? 3 : 2)}`;

export function runDuration(run: Pick<RoutineRun, "startedAt" | "finishedAt">) {
  if (!run.startedAt) return "—";
  const ms = (run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

/** Time until a future ISO date, e.g. "in 4m", "in 2h", "in 3d". */
export function untilTime(iso: string | null) {
  if (!iso) return "—";
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (m < 1) return "any moment";
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** Routines (optionally one project's), refreshed every few seconds while mounted. */
export function useRoutines(projectId?: string, initial: RoutineSummary[] | null = null, intervalMs = 5000) {
  const [routines, setRoutines] = useState<RoutineSummary[] | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await api.listRoutines(projectId);
      setRoutines(data.routines);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, intervalMs);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh, intervalMs]);
  return { routines, error, refresh };
}
