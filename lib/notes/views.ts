import { z } from "zod";
import type { NoteMeta } from "./types";

export const noteFilters = {
  all: "All notes",
  pinned: "Pinned",
  inject: "In session context",
  tasks: "Open tasks",
  memory: "Memory",
} as const;
export type NoteFilter = keyof typeof noteFilters;
export const savedNoteViewsSchema = z.array(z.object({
  name: z.string().trim().min(1).max(60),
  query: z.string().max(500),
  filter: z.enum(["all", "pinned", "inject", "tasks", "memory"]),
}));
export type SavedNoteView = z.infer<typeof savedNoteViewsSchema>[number];

export function matchesNoteView(note: NoteMeta, query: string, filter: NoteFilter) {
  const matchesFilter = filter === "all" || (filter === "tasks" ? note.actionable && note.openTasks > 0
    : filter === "memory" ? note.id === "memory" : note[filter]);
  return matchesFilter && `${note.title} ${note.excerpt} ${note.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
}
