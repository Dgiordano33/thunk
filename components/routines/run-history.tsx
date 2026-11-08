"use client";

import { ExternalLinkIcon, GitPullRequestIcon, NotebookTextIcon, SquareIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { OPEN_RUN_STATUSES, RUN_TRIGGER_LABELS, type RoutineRun } from "@/lib/routines/types";
import { isSkipRun, RunStatusBadge, runDuration, usd } from "./shared";

/** A routine's recent runs, newest first, refreshed while any is open. */
export function RunHistory({ routineId, projectId, refreshKey }: { routineId: string; projectId: string; refreshKey?: number }) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSkips, setShowSkips] = useState(false);

  const load = useCallback(async () => {
    try {
      setRuns((await api.listRoutineRuns(routineId, 30)).runs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [routineId]);

  const open = runs?.some((r) => OPEN_RUN_STATUSES.includes(r.status)) ?? false;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await load();
      if (!stopped) timer = setTimeout(loop, open ? 2500 : 10_000);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, open, refreshKey]);

  if (error && !runs) return <p className="text-destructive text-xs">{error}</p>;
  if (!runs) return <p className="text-muted-foreground text-xs">Loading runs…</p>;
  const skips = runs.filter(isSkipRun).length;
  const shown = showSkips ? runs : runs.filter((r) => !isSkipRun(r));
  if (!shown.length)
    return (
      <p className="text-muted-foreground text-xs">
        No runs yet. Press Run now to try it.
        {skips > 0 && (
          <button type="button" className="text-primary ml-1 hover:underline" onClick={() => setShowSkips(true)}>
            Show {skips} skipped
          </button>
        )}
      </p>
    );

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1.5">
        {shown.map((run) => (
          <RunRow key={run.id} run={run} routineId={routineId} projectId={projectId} onChange={load} />
        ))}
      </ul>
      {skips > 0 && (
        <button type="button" className="text-muted-foreground self-start text-[11px] hover:underline" onClick={() => setShowSkips(!showSkips)}>
          {showSkips ? "Hide skipped" : `Show ${skips} skipped`}
        </button>
      )}
    </div>
  );
}

function RunRow({ run, routineId, projectId, onChange }: { run: RoutineRun; routineId: string; projectId: string; onChange: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const isOpen = OPEN_RUN_STATUSES.includes(run.status);
  const d = run.diffStat;
  const sessionHref = run.sessionId ? (run.workspaceId ? `/w/${run.workspaceId}/s/${run.sessionId}` : `/p/${projectId}?session=${run.sessionId}`) : null;
  return (
    <li className="bg-background rounded-lg border px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <RunStatusBadge run={run} />
        <span className="text-muted-foreground">{RUN_TRIGGER_LABELS[run.triggerSource]}</span>
        <span className="text-muted-foreground ml-auto tabular-nums" title={run.startedAt ?? run.createdAt}>
          {relativeTime(run.startedAt ?? run.createdAt)}
          {run.startedAt && ` · ${runDuration(run)}`}
          {run.costUsd > 0 && ` · ${usd(run.costUsd)}`}
        </span>
      </div>
      {run.summary && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed">{run.summary}</p>}
      {run.error && <p className={isSkipRun(run) ? "text-muted-foreground mt-1 text-[11px]" : "text-destructive mt-1 text-[11px]"}>{run.error}</p>}
      {(d?.files || run.prUrl || sessionHref || run.noteId || isOpen) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {d && d.files > 0 && (
            <span className="font-mono tabular-nums" title={d.paths.map((p) => `${p.status} ${p.path}`).join("\n")}>
              <span className="text-emerald-600 dark:text-emerald-400">+{d.additions}</span>{" "}
              <span className="text-red-600 dark:text-red-400">−{d.deletions}</span> · {d.files} {d.files === 1 ? "file" : "files"}
            </span>
          )}
          {run.prUrl && (
            <a href={run.prUrl} target="_blank" rel="noreferrer" className="text-primary flex items-center gap-1 hover:underline">
              <GitPullRequestIcon className="size-3" /> PR #{run.prUrl.split("/").pop()}
            </a>
          )}
          {sessionHref && (
            <Link href={sessionHref} className="text-primary flex items-center gap-1 hover:underline">
              <ExternalLinkIcon className="size-3" /> Open session
            </Link>
          )}
          {run.noteId && (
            <Link href={`/p/${projectId}?building=library&note=${run.noteId}`} scroll={false} className="text-primary flex items-center gap-1 hover:underline">
              <NotebookTextIcon className="size-3" /> Report note
            </Link>
          )}
          {isOpen && (
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={cancelling}
              onClick={async () => {
                setCancelling(true);
                try {
                  await api.cancelRoutineRun(routineId, run.id);
                  onChange();
                } catch (err) {
                  window.alert(`Couldn't cancel: ${(err as Error).message}`);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              <SquareIcon /> Cancel
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
