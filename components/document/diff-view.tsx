"use client";

import { diffWords } from "diff";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** Inline redline of the user's edits: removals struck through, additions highlighted. */
export function DiffView({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const changed = parts.some((p) => p.added || p.removed);
  return (
    <pre className={cn("font-mono text-[13px] leading-relaxed whitespace-pre-wrap", className)}>
      {!changed && <span className="text-muted-foreground">No text edits.</span>}
      {changed &&
        parts.map((p, i) => (
          <span
            key={i}
            className={cn(
              p.added && "rounded-sm bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              p.removed && "rounded-sm bg-red-500/15 text-red-700 line-through dark:text-red-300",
              !p.added && !p.removed && "text-muted-foreground",
            )}
          >
            {p.value}
          </span>
        ))}
    </pre>
  );
}
