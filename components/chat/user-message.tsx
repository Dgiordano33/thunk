"use client";

import { ChevronRightIcon, FilePenLineIcon } from "lucide-react";
import { useState } from "react";
import { plural } from "@/components/canvas/revision-bar";
import type { TimelineItem } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

export function UserMessage({ item }: { item: Extract<TimelineItem, { kind: "user" }> }) {
  const [open, setOpen] = useState(false);

  if (item.revision) {
    return (
      <div className="self-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
        >
          <FilePenLineIcon className="size-3.5" />
          Sent revisions · {plural(item.revision.edits, "edit")} · {plural(item.revision.comments, "comment")}
          <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        </button>
        {open && (
          <pre className="bg-muted mt-2 max-h-80 max-w-2xl overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
            {item.content}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="bg-secondary text-secondary-foreground max-w-[80%] self-end rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
      {item.queued && <div className="text-muted-foreground mb-1 text-xs">Queued</div>}
      {item.images?.map((image, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={image.url} alt={image.filename ?? "Attached image"} className="mb-2 max-h-48 rounded-lg" />
      ))}
      {item.content}
    </div>
  );
}
