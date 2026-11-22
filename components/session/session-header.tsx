"use client";

import { projectSectionPath } from "@/lib/routes";

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
import { usePaths } from "@/components/layout/paths-context";

import { sessionStatus, sessionDot } from "./labels";

export function SessionHeader({ onResume }: { onResume: () => Promise<void> }) {
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const connection = useSession((s) => s.connection);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasTurns = useSession((s) => s.items.some((item) => item.kind === "user" || item.kind === "turn"));
  if (!meta) return null;

  const live = meta.live && connection !== "not_live";


  return (
    <header className="flex min-h-11 md:h-10 shrink-0 items-center gap-3 border-b px-3">
      <h1 className="min-w-0 truncate pixel text-base leading-tight">{meta.title || "Untitled session"}</h1>
      {meta.origin?.kind === "chief" && meta.title?.toLowerCase() !== "chief" && <Badge variant="outline">Chief</Badge>}
      {meta.origin?.kind === "top_chief" && meta.title?.toLowerCase() !== "top chief" && <Badge variant="outline">Top chief</Badge>}
      {meta.origin?.kind === "worker" && meta.title?.toLowerCase() !== "worker" && <Badge variant="outline">Worker</Badge>}
      {meta.origin?.kind === "routine" && <RoutineBadge meta={meta} origin={meta.origin} />}
      <Badge variant="outline" className="h-5 shrink-0 gap-1.5 text-[11px]" role="status" aria-live="polite">
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", sessionDot({ live, status }))} />
        {sessionStatus({ ...meta, live, status })}
      </Badge>
      {connection === "reconnecting" && <span className="text-muted-foreground text-xs">Reconnecting…</span>}
      <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
        <span className="hidden md:contents"><CommentsToggle /></span>
        {error && <span className="text-destructive">{error}</span>}
        {hasTurns && (!live || status === "error" || status === "closed") && (
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
  const paths = usePaths();
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
      <Link href={projectSectionPath(paths.project(meta.projectId), "workshop", { routine: origin.routineId })} title="Started by a routine">
        <HourglassIcon /> <span className="truncate">Routine · {origin.routineName}</span>
      </Link>
    </Badge>
  );
}
