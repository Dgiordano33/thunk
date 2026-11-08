"use client";

import { BrainIcon, ListChecksIcon, LockIcon, PinIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { MEMORY_NOTE_ID, type NoteMeta } from "@/lib/notes/types";
import { cn } from "@/lib/utils";

/**
 * Apple Notes-style rows: title, time, excerpt, and badges for pinned, injected and open tasks.
 * ↑/↓ move, Enter opens, ⌘N creates, ⌘⌫ deletes (memory can't be deleted).
 */
export function NoteList({
  notes,
  selectedId,
  onSelect,
  onCreate,
  createControl,
  onDelete,
  compact,
  emptyText = "No notes yet.",
  keyOf = (n) => n.id,
  contextOf,
}: {
  notes: NoteMeta[] | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  /** Replaces the default "New note" button, e.g. with a notebook picker. */
  createControl?: React.ReactNode;
  onDelete?: (note: NoteMeta) => void;
  /** Drop the search box (for short embedded lists). */
  compact?: boolean;
  emptyText?: string;
  /** Row identity passed to onSelect; override when listing notes from several scopes. */
  keyOf?: (note: NoteMeta) => string;
  /** Where the note lives, shown under the title (for mixed-scope lists). */
  contextOf?: (note: NoteMeta) => string;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!notes || !q) return notes;
    return notes.filter((n) => `${n.title} ${n.excerpt} ${n.tags.join(" ")}`.toLowerCase().includes(q));
  }, [notes, query]);

  const focusRow = (i: number) => listRef.current?.querySelectorAll<HTMLButtonElement>("[data-note-row]")[i]?.focus();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!shown?.length) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-note-row]") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = i < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
      focusRow(next);
      onSelect(keyOf(shown[next]));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Backspace" && i >= 0 && onDelete) {
      e.preventDefault();
      if (shown[i].id !== MEMORY_NOTE_ID) onDelete(shown[i]);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && onCreate) {
          e.preventDefault();
          onCreate();
        }
      }}
    >
      {!compact && (
        <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1">
          <label className="bg-background focus-within:ring-ring flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 focus-within:ring-2">
            <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  focusRow(0);
                  if (shown?.[0]) onSelect(keyOf(shown[0]));
                }
              }}
              placeholder="Search notes"
              aria-label="Search notes"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </label>
          {createControl ??
            (onCreate && (
              <Button size="icon-sm" variant="outline" onClick={onCreate} aria-label="New note" title="New note (⌘N)">
                <PlusIcon />
              </Button>
            ))}
        </div>
      )}
      {shown === null ? (
        <div className="flex flex-col gap-1.5 p-2">
          {[0, 1, 2].map((i) => <div key={i} className="bg-muted/50 h-14 animate-pulse rounded-lg" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-center text-xs">{query ? "No matching notes." : emptyText}</p>
      ) : (
        <ul ref={listRef} className="flex flex-col gap-1 overflow-y-auto p-2" onKeyDown={onKeyDown}>
          {shown.map((n) => (
            <li key={keyOf(n)}>
              <NoteRow note={n} context={contextOf?.(n)} selected={keyOf(n) === selectedId} onSelect={() => onSelect(keyOf(n))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({ note, context, selected, onSelect }: { note: NoteMeta; context?: string; selected: boolean; onSelect: () => void }) {
  const memory = note.id === MEMORY_NOTE_ID;
  return (
    <button
      type="button"
      data-note-row
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "bg-background hover:bg-muted/50 focus-visible:ring-ring flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2",
        selected && "border-foreground/25 bg-muted/60",
      )}
    >
      <span className="flex items-center gap-1.5">
        {memory ? (
          <LockIcon className="text-muted-foreground size-3 shrink-0" aria-label="Memory" />
        ) : (
          note.pinned && <PinIcon className="text-muted-foreground size-3 shrink-0" aria-label="Pinned" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{note.title}</span>
        {note.inject && !memory && <BrainIcon className="text-muted-foreground size-3 shrink-0" aria-label="Injected into sessions" />}
        {note.actionable && note.openTasks > 0 && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums" title={`${note.openTasks} open tasks`}>
            <ListChecksIcon className="size-3" />
            {note.openTasks}
          </span>
        )}
      </span>
      {context && <span className="text-muted-foreground truncate text-[11px]">{context}</span>}
      <span className="text-muted-foreground flex gap-1.5 text-[11px]">
        <span className="shrink-0 tabular-nums">{relativeTime(note.updatedAt)}</span>
        <span className="min-w-0 truncate">{note.excerpt || (memory ? "Shared by every session. Agents read and edit it." : "No text")}</span>
      </span>
    </button>
  );
}
