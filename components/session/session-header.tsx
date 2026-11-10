"use client";

import { HourglassIcon, Loader2Icon, MessageSquareIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionMeta } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/store/session-store";
import { useUi } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  starting: "Starting",
  idle: "Idle",
  running: "Working",
  awaiting: "Needs you",
  closed: "Closed",
  error: "Error",
};

export function SessionHeader({ onResume }: { onResume: () => Promise<void> }) {
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const connection = useSession((s) => s.connection);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return null;

  const live = meta.live && connection !== "not_live";
  const chiefOwns = status === "awaiting" && meta.waitingOn === "chief";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <h1 className="min-w-0 truncate text-sm font-medium">{meta.title || "Untitled session"}</h1>
      {meta.origin?.kind === "chief" && <Badge variant="outline">Chief</Badge>}
      {meta.origin?.kind === "worker" && <Badge variant="outline">Worker · {meta.title || meta.origin.taskId.slice(0, 8)}</Badge>}
      {meta.origin?.kind === "routine" && <RoutineBadge meta={meta} origin={meta.origin} />}
      {live ? (
        <Badge
          variant="outline"
          className={cn(
            "h-5 gap-1.5 text-[11px]",
            status === "awaiting" && !chiefOwns && "border-amber-500/50 text-amber-700 dark:text-amber-400",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              status === "running" ? "animate-pulse bg-amber-500" : status === "awaiting" ? (chiefOwns ? "bg-sky-500" : "bg-amber-500") : "bg-emerald-500",
            )}
          />
          {chiefOwns ? "Asking the chief" : STATUS_LABEL[status] ?? status}
        </Badge>
      ) : (
        <Badge variant="secondary" className="h-5 text-[11px]">
          Not live
        </Badge>
      )}
      {connection === "reconnecting" && <span className="text-muted-foreground text-xs">Reconnecting…</span>}
      <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
        <CommentsToggle />
        {error && <span className="text-destructive">{error}</span>}
        {(!live || status === "error" || status === "closed") && (
          <Button
            size="sm"
            disabled={resuming}
            onClick={async () => {
              setResuming(true);
              setError(null);
              try {
                await onResume();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setResuming(false);
              }
            }}
          >
            {resuming ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
            Resume
          </Button>
        )}
      </div>
    </header>
  );
}

function CommentsToggle() {
  const open = useUi((s) => s.commentsOpen);
  const setOpen = useUi((s) => s.setCommentsOpen);
  const count = useSession((s) =>
    s.activeDocumentId ? (s.documents[s.activeDocumentId]?.comments.filter((c) => c.status === "open").length ?? 0) : 0,
  );
  return (
    <Button
      size="sm"
      variant={open ? "secondary" : "ghost"}
      className="h-7 gap-1 px-2"
      aria-label={open ? "Hide comments" : "Show comments"}
      aria-pressed={open}
      title={open ? "Hide comments" : "Show comments"}
      onClick={() => setOpen(!open)}
    >
      <MessageSquareIcon />
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </Button>
  );
}

/** "Routine · <name>", linking to the routine in its town's Workshop (or marked deleted). */
function RoutineBadge({ meta, origin }: { meta: SessionMeta; origin: Extract<SessionMeta["origin"], { kind: "routine" }> }) {
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getRoutine(origin.routineId).then(
      () => alive && setDeleted(false),
      (err: Error) => alive && setDeleted(/not found|404/i.test(err.message)),
    );
    return () => {
      alive = false;
    };
  }, [origin.routineId]);
  if (deleted)
    return (
      <Badge variant="outline" className="text-muted-foreground h-5 gap-1 text-[11px]">
        <HourglassIcon /> Routine (deleted)
      </Badge>
    );
  return (
    <Badge variant="outline" className="h-5 max-w-48 gap-1 text-[11px]" asChild>
      <Link href={`/p/${meta.projectId}?building=workshop&routine=${origin.routineId}`} title="Started by a routine">
        <HourglassIcon /> <span className="truncate">Routine · {origin.routineName}</span>
      </Link>
    </Badge>
  );
}
