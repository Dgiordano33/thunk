"use client";

import { Loader2Icon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { MODE_LABELS, modelLabel } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/store/session-store";
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
        <span className="hidden lg:inline">
          {modelLabel(meta.model)} · {MODE_LABELS[meta.permissionMode] ?? meta.permissionMode}
        </span>
        {costUsd > 0 && <span className="font-mono">${costUsd.toFixed(3)}</span>}
        {error && <span className="text-destructive">{error}</span>}
        {!live && (
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
