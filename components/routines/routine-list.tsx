"use client";

import { Loader2Icon, MoreHorizontalIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import type { RoutineSummary } from "@/lib/routines/types";
import { cn } from "@/lib/utils";
import { RunStatusBadge, triggerSummary, untilTime } from "./shared";

/** Run now; surfaces "already running" and other refusals inline instead of failing silently. */
export function RunNowButton({ routine, onStarted, className }: { routine: RoutineSummary; onStarted: () => void; className?: string }) {
  const [pending, setPending] = useState(false);
  const busy = Boolean(routine.activeRun);
  return (
    <Button
      size="xs"
      variant="outline"
      className={className}
      disabled={pending || busy}
      title={busy ? "A run is in progress" : "Start a run now"}
      onClick={async (e) => {
        e.stopPropagation();
        setPending(true);
        try {
          await api.runRoutine(routine.id);
          onStarted();
        } catch (err) {
          window.alert(`Couldn't start the run: ${(err as Error).message}`);
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Run now
    </Button>
  );
}

/** The Workshop's standing orders: one row per routine with its status, next run and actions. */
export function RoutineList({
  routines,
  selectedId,
  onSelect,
  onChange,
}: {
  routines: RoutineSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {routines.map((r) => {
        const run = r.activeRun ?? r.lastRun;
        return (
          <li
            key={r.id}
            className={cn("bg-background rounded-lg border transition-colors", selectedId === r.id && "border-foreground/30", !r.enabled && "opacity-70")}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => onSelect(r.id)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">{r.name}</span>
                  {!r.enabled && <span className="text-muted-foreground text-[11px]">Disabled</span>}
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {triggerSummary(r)}
                  {r.enabled && r.nextRunAt && ` · next ${untilTime(r.nextRunAt)}`}
                  {run && !r.activeRun && ` · last ${relativeTime(run.createdAt)}`}
                </span>
              </button>
              {run && <RunStatusBadge run={run} />}
              <RunNowButton routine={r} onStarted={onChange} />
              <RoutineMenu routine={r} onEdit={() => onSelect(r.id)} onChange={onChange} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RoutineMenu({ routine, onEdit, onChange }: { routine: RoutineSummary; onEdit: () => void; onChange: () => void }) {
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`${routine.name} actions`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act(() => api.updateRoutine(routine.id, { enabled: !routine.enabled }))}>
          {routine.enabled ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            if (window.confirm(`Delete “${routine.name}” and its run history? Workspaces and notes it created are kept.`))
              void act(() => api.deleteRoutine(routine.id));
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
