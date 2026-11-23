// Shared between server and client: no server-only imports here.
import { noteTitle, parseNote } from "@/lib/notes/frontmatter";

const titleFrom = (filename: string) => filename.replace(/\.[a-z0-9]{1,10}$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled";

/** A markdown or text file as a note: drop any frontmatter, title from it, the first heading, or the file name. */
export function textToNote(filename: string, raw: string, fallbackTitle?: string) {
  const parsed = parseNote(raw.replace(/^﻿/, "").replace(/\r\n/g, "\n"));
  return { title: noteTitle(parsed, fallbackTitle ?? titleFrom(filename)).slice(0, 200), markdown: parsed.body.replace(/^\n+/, "").trimEnd() + "\n" };
}
