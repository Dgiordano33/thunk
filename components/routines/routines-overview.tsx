"use client";

import Link from "next/link";
import { relativeTime } from "@/components/session/labels";
import { CivPanel } from "@/components/world/civ-panel";
import { PixelIcon } from "@/components/world/pixel-icon";
import { api } from "@/lib/client/api";
import type { RoutineSummary } from "@/lib/routines/types";
import { cn } from "@/lib/utils";
import { RunNowButton } from "./routine-list";
import { RunStatusBadge, triggerSummary, untilTime, useRoutines } from "./shared";

/** Every project's routines in one table, refreshed every few seconds. */
export function RoutinesOverview({
  initial,
  workspaceLabels,
  firstProjectId,
}: {
  initial: RoutineSummary[];
  workspaceLabels: Record<string, string>;
  firstProjectId: string | null;
}) {
  const { routines, refresh } = useRoutines(undefined, initial);
  const list = routines ?? [];

  if (!list.length)
    return (
      <main className="fog absolute inset-0 flex items-center justify-center p-6">
        <CivPanel parchment className="w-full max-w-md" bodyClassName="flex flex-col items-center px-8 py-8 text-center">
          <PixelIcon name="hourglass" className="mb-4 size-14" />
          <p className="pixel text-xs tracking-widest uppercase opacity-60">Routines</p>
          <h1 className="pixel mt-1 text-3xl">No standing orders</h1>
          <p className="mt-3 text-sm leading-relaxed opacity-80">
            Routines are agent sessions that run on a schedule, on demand, or when something happens, and report back to the city
            that owns them. Each city builds its own in its Workshop.
          </p>
          <Link
            href={firstProjectId ? `/p/${firstProjectId}?building=workshop&routine=new` : "/"}
            className="pixel mt-6 text-sm underline underline-offset-4 hover:opacity-80"
          >
            {firstProjectId ? "Visit a Workshop →" : "← Found a city first"}
          </Link>
        </CivPanel>
      </main>
    );

  const head = "text-muted-foreground px-3 py-2 text-left text-[11px] font-medium";
  return (
    <main className="absolute inset-x-4 top-20 z-10 flex justify-center" style={{ bottom: process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full max-w-6xl" bodyClassName="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="pixel text-muted-foreground text-[11px] tracking-widest uppercase">Standing orders</p>
            <h2 className="pixel text-lg leading-tight">
              {list.length} {list.length === 1 ? "routine" : "routines"} · {list.filter((r) => r.enabled).length} active
            </h2>
          </div>
          <p className="text-muted-foreground hidden text-[11px] sm:block">Routines fire only while Thunk is running.</p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-popover sticky top-0 border-b">
              <tr>
                <th className={head}>Name</th>
                <th className={head}>Project</th>
                <th className={head}>Runs in</th>
                <th className={head}>Trigger</th>
                <th className={head}>Last run</th>
                <th className={head}>Next run</th>
                <th className={cn(head, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const run = r.activeRun ?? r.lastRun;
                return (
                  <tr key={r.id} className={cn("hover:bg-muted/50 border-b last:border-b-0", !r.enabled && "opacity-70")}>
                    <td className="max-w-56 px-3 py-2">
                      <Link href={`/p/${r.projectId}?building=workshop&routine=${r.id}`} className="block truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/p/${r.projectId}`} className="text-muted-foreground hover:underline">
                        {r.projectName}
                      </Link>
                    </td>
                    <td className="text-muted-foreground px-3 py-2">
                      {r.targetKind === "ephemeral" ? "Fresh worktree" : (r.targetWorkspaceId && workspaceLabels[r.targetWorkspaceId]) || "Workspace"}
                    </td>
                    <td className="text-muted-foreground max-w-56 truncate px-3 py-2">{triggerSummary(r)}</td>
                    <td className="px-3 py-2">
                      {run ? (
                        <span className="flex items-center gap-2">
                          <RunStatusBadge run={run} />
                          <span className="text-muted-foreground">{relativeTime(run.createdAt)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 tabular-nums" title={r.nextRunAt ?? undefined}>
                      {r.enabled && r.nextRunAt ? untilTime(r.nextRunAt) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center justify-end gap-2">
                        <RunNowButton routine={r} onStarted={() => void refresh()} />
                        <EnabledToggle routine={r} onChange={() => void refresh()} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CivPanel>
    </main>
  );
}

function EnabledToggle({ routine, onChange }: { routine: RoutineSummary; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={routine.enabled}
      aria-label={`${routine.enabled ? "Disable" : "Enable"} ${routine.name}`}
      title={routine.enabled ? "Enabled" : "Disabled"}
      onClick={async () => {
        try {
          await api.updateRoutine(routine.id, { enabled: !routine.enabled });
          onChange();
        } catch (err) {
          window.alert((err as Error).message);
        }
      }}
      className={cn(
        "focus-visible:ring-ring relative h-4 w-7 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2",
        routine.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow transition-transform", routine.enabled && "translate-x-3")} />
    </button>
  );
}
