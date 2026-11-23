"use client";

import { BotIcon, BrainIcon, ChevronRightIcon, ListChecksIcon, PinIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useStoredFlag } from "@/lib/client/use-stored-flag";
import { Hint } from "@/components/hint";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { WORLD_SELECTION } from "@/components/world/selection";
import { MEMORY_NOTE_ID, type NoteMeta } from "@/lib/notes/types";
import { matchesNoteView, noteFilters, type NoteFilter } from "@/lib/notes/views";
import { NoteFilters } from "./note-filters";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription } from "@/components/ui/empty";

const MEMORY_OPEN_KEY = "thunk.notes.memoryOpen";

/**
 * Apple Notes-style rows: title, excerpt, and marks for pinned, session context, open items and agent edits.
 * ↑/↓ move, Enter opens, ⌘N creates, ⌘⌫ deletes (memory can't be deleted).
 */
export function NoteList({
  notes,
  selectedId,
  onSelect,
  onCreate,
  createControl,
  extraControl,
  onDelete,
  compact,
  groupMemory,
  emptyText = "Notes are plans and reference that agents can read and write. Start a note to give your next session context.",
  keyOf = (n) => n.id,
  contextOf,
}: {
  notes: NoteMeta[] | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  /** Replaces the default "New note" button, e.g. with a notebook picker. */
  createControl?: React.ReactNode;
  /** Rendered before the create control, e.g. an "Add files" button. */
  extraControl?: React.ReactNode;
  onDelete?: (note: NoteMeta) => void;
  /** Drop the search box (for short embedded lists). */
  compact?: boolean;
  /** Fold every memory note into one collapsible group, so many scopes' memory doesn't bury the notes. */
  groupMemory?: boolean;
  emptyText?: string;
  /** Row identity passed to onSelect; override when listing notes from several scopes. */
  keyOf?: (note: NoteMeta) => string;
  /** Where the note lives (for mixed-scope lists). */
  contextOf?: (note: NoteMeta) => string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [memoryOpen, setMemoryOpen] = useStoredFlag(MEMORY_OPEN_KEY, false);
  const toggleMemory = () => setMemoryOpen(!memoryOpen);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => notes?.filter((note) => matchesNoteView(note, query, filter)) ?? null, [notes, query, filter]);
  // A search or the Memory filter shows memory inline; otherwise it folds into the group.
  const grouping = Boolean(groupMemory) && filter !== "memory" && !query.trim();
  const memory = useMemo(() => (grouping ? (shown?.filter((n) => n.id === MEMORY_NOTE_ID) ?? []) : []), [grouping, shown]);
  const main = useMemo(() => (grouping ? (shown?.filter((n) => n.id !== MEMORY_NOTE_ID) ?? null) : shown), [grouping, shown]);
  const byKey = useMemo(() => new Map((shown ?? []).map((n) => [keyOf(n), n])), [shown, keyOf]);

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-note-row]") ?? [])];
  const focusRow = (i: number) => {
    const row = rows()[i];
    if (!row) return;
    row.focus();
    onSelect(row.dataset.noteRow!);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = rows();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!all.length) return;
      e.preventDefault();
      focusRow(i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Backspace" && i >= 0 && onDelete) {
      e.preventDefault();
      const note = byKey.get(all[i].dataset.noteRow!);
      if (note && note.id !== MEMORY_NOTE_ID) onDelete(note);
    }
  };

  const row = (n: NoteMeta) => (
    <li key={keyOf(n)}>
      <NoteRow note={n} rowKey={keyOf(n)} context={contextOf?.(n)} selected={keyOf(n) === selectedId} onSelect={() => onSelect(keyOf(n))} />
    </li>
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
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
                }
              }}
              maxLength={500}
              placeholder="Search notes"
              aria-label="Search notes"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </label>
          <NoteFilters query={query} filter={filter} onChange={(nextQuery, nextFilter) => { setQuery(nextQuery); setFilter(nextFilter); }} />
          {extraControl}
          {createControl ??
            (onCreate && (
              <Hint label="New note" keys="⌘N">
                <Button size="icon-sm" variant="outline" onClick={onCreate} aria-label="New note">
                  <PlusIcon />
                </Button>
              </Hint>
            ))}
        </div>
      )}
      {!compact && filter !== "all" && (
        <div className="flex items-center justify-between px-3 py-1 text-xs text-muted-foreground">
          <span>{noteFilters[filter]} · {shown?.length ?? 0}</span>
          <Button size="xs" variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}>Clear</Button>
        </div>
      )}
      {shown === null ? (
        <div className="flex flex-col gap-1.5 p-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : shown.length === 0 ? (
        <Empty className="py-6 gap-2"><EmptyDescription className="text-xs">{query || filter !== "all" ? "No matching notes." : emptyText}</EmptyDescription>{!query && filter === "all" && onCreate && <Button size="sm" onClick={onCreate}>New note</Button>}</Empty>
      ) : (
        <ul ref={listRef} className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2" onKeyDown={onKeyDown}>
          {memory.length > 0 && (
            <li>
              <button
                type="button"
                aria-expanded={memoryOpen}
                onClick={toggleMemory}
                className="text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:ring-ring flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs outline-none focus-visible:ring-2"
              >
                <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none", memoryOpen && "rotate-90")} />
                <BrainIcon className="size-3.5 shrink-0" />
                <span className="font-medium">Memory</span>
                <span className="tabular-nums">{memory.length}</span>
                <span className="ml-auto truncate">in every session</span>
              </button>
              {memoryOpen && <ul className="mt-1 flex flex-col gap-1">{memory.map(row)}</ul>}
            </li>
          )}
          {main?.map(row)}
          {main?.length === 0 && <li className="text-muted-foreground px-2 py-4 text-center text-xs">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}

function NoteRow({ note, rowKey, context, selected, onSelect }: { note: NoteMeta; rowKey: string; context?: string; selected: boolean; onSelect: () => void }) {
  const memory = note.id === MEMORY_NOTE_ID;
  const base = cn(
    "bg-background hover:bg-muted/50 focus-visible:ring-ring flex w-full rounded-lg border text-left transition-colors outline-none focus-visible:ring-2",
    selected && WORLD_SELECTION,
  );

  if (memory)
    return (
      <button type="button" data-note-row={rowKey} aria-current={selected ? "true" : undefined} onClick={onSelect} className={cn(base, "items-center gap-1.5 px-3 py-1.5 text-[12px]")}>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{note.title}</span>
          {context && <span className="text-muted-foreground"> · {context}</span>}
        </span>
        {note.editedOutside && <AgentMark />}
        <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{relativeTime(note.updatedAt)}</span>
      </button>
    );

  const extraTags = note.tags.length - 2;
  return (
    <button type="button" data-note-row={rowKey} aria-current={selected ? "true" : undefined} onClick={onSelect} className={cn(base, "flex-col gap-0.5 px-3 py-2")}>
      <span className="flex w-full items-center gap-1.5">
        {note.pinned && <PinIcon className="text-muted-foreground size-3 shrink-0" aria-label="Pinned" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{note.title}</span>
        {note.inject && (
          <Hint label="In session context: new sessions get this note in their system prompt">
            <BrainIcon className="text-muted-foreground size-3 shrink-0" aria-label="In session context" />
          </Hint>
        )}
        {note.actionable && note.openTasks > 0 && (
          <Hint label={`${note.openTasks} unchecked item${note.openTasks === 1 ? "" : "s"}`}>
            <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums" aria-label={`${note.openTasks} unchecked items`}>
              <ListChecksIcon className="size-3" />
              {note.openTasks}
            </span>
          </Hint>
        )}
      </span>
      <span className="text-muted-foreground w-full truncate text-[12px]">{note.excerpt || "Empty"}</span>
      <span className="text-muted-foreground flex w-full min-w-0 items-center gap-1.5 text-[11px]">
        <span className="shrink-0 tabular-nums">{relativeTime(note.updatedAt)}</span>
        {note.editedOutside && <AgentMark />}
        {note.source === "repo" ? (
          <span className="min-w-0 truncate" title={note.path}>· repo · {note.path.split("/").slice(-2).join("/")}</span>
        ) : (
          context && <span className="min-w-0 truncate">· {context}</span>
        )}
        {note.tags.length > 0 && (
          <span className="ml-auto flex shrink-0 gap-1">
            {note.tags.slice(0, 2).map((t) => <span key={t} className="max-w-20 truncate rounded border px-1 text-[10px]">#{t}</span>)}
            {extraTags > 0 && <span className="text-[10px]">+{extraTags}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/** The file changed after Thunk's last write: an agent edited it. */
function AgentMark() {
  return (
    <span className="flex shrink-0 items-center gap-0.5 rounded bg-[color-mix(in_oklch,var(--w-bronze)_18%,transparent)] px-1 text-[10px] text-foreground">
      <BotIcon className="size-3" aria-hidden />
      Agent edit
    </span>
  );
}
