"use client";

import dynamic from "next/dynamic";

export const NoteEditor = dynamic(
  () => import("./note-editor-content").then((mod) => mod.NoteEditor),
  { loading: () => <p role="status" className="text-muted-foreground p-6 text-sm">Loading editor…</p> },
);
