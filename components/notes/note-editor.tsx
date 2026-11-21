"use client";

import dynamic from "next/dynamic";
import { Loader2Icon } from "lucide-react";

export const NoteEditor = dynamic(
  () => import("./note-editor-content").then((mod) => mod.NoteEditor),
  {
    // Same spinner the editor shows while the note loads, so the pane doesn't swap indicators.
    loading: () => (
      <div role="status" aria-label="Loading note" className="text-muted-foreground flex flex-1 justify-center p-8">
        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
      </div>
    ),
  },
);
