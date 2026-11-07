"use client";

import { InfoIcon, Loader2Icon, MessageSquareIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { MODE_LABELS, modelLabel } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { providerOf } from "@/lib/agent/types";
import { useModels } from "@/lib/client/use-models";
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
  const models = useModels();
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const connection = useSession((s) => s.connection);
  const costUsd = useSession((s) => s.costUsd);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return null;

  const live = meta.live && connection !== "not_live";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <h1 className="min-w-0 truncate text-sm font-medium">{meta.title || "Untitled session"}</h1>
      {live ? (
        <Badge
          variant="outline"
          className={cn(
            "h-5 gap-1.5 text-[11px]",
            status === "awaiting" && "border-amber-500/50 text-amber-700 dark:text-amber-400",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              status === "running" ? "animate-pulse bg-amber-500" : status === "awaiting" ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          {STATUS_LABEL[status] ?? status}
        </Badge>
      ) : (
        <Badge variant="secondary" className="h-5 text-[11px]">
          Not live
        </Badge>
      )}
      {connection === "reconnecting" && <span className="text-muted-foreground text-xs">Reconnecting…</span>}
      <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
        <Popover>
          <PopoverTrigger className="hover:text-foreground hidden items-center gap-1.5 transition-colors lg:flex">
            {modelLabel(meta.model, models)} · {MODE_LABELS[meta.permissionMode] ?? meta.permissionMode}
            <InfoIcon className="size-3" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-0">
            <SessionInfo />
          </PopoverContent>
        </Popover>
        <CommentsToggle />
        {costUsd > 0 && <span className="font-mono">${costUsd.toFixed(3)}</span>}
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

function SessionInfo() {
  const models = useModels();
  const meta = useSession((s) => s.meta);
  const costUsd = useSession((s) => s.costUsd);
  const numTurns = useSession((s) => s.numTurns);
  const connection = useSession((s) => s.connection);
  const docCount = useSession((s) => Object.keys(s.documents).length);
  if (!meta) return null;

  const rows: [string, string][] = [
    ["Directory", meta.cwd],
    ["Model", modelLabel(meta.model, models)],
    ["Mode", MODE_LABELS[meta.permissionMode] ?? meta.permissionMode],
    ["Status", meta.live ? meta.status : "not live"],
    ["Connection", connection],
    // Codex reports tokens, not dollars.
    ["Cost", providerOf(meta.model) === "codex" ? "Not reported" : `$${costUsd.toFixed(4)}`],
    ["API turns", String(numTurns)],
    ["Documents", String(docCount)],
    ["SDK session", meta.sdkSessionId ?? "—"],
    ["Thunk session", meta.id],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
