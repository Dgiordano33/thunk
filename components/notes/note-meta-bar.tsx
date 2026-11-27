"use client";

import { useIsDesktop } from "@/components/mobile/viewport";
import { MobileDrawer } from "@/components/mobile/drawer";
import { BrainIcon, CopyIcon, ShapesIcon, EllipsisIcon, PinIcon, SendIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MEMORY_NOTE_ID, type NoteFlags, type NoteMeta } from "@/lib/notes/types";
import { WorkspaceLinks } from "./workspace-links";
import { cn } from "@/lib/utils";

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** Pressed toggles read as accent tints, like every other selection. */
const PRESSED = "border-[var(--w-bronze)]/60 bg-[color-mix(in_oklch,var(--w-bronze)_18%,transparent)] text-foreground";

const copyPath = (path: string) =>
  navigator.clipboard.writeText(path).then(
    () => toast.success("Path copied"),
    (err: Error) => toast.error("Couldn't copy the path", { description: err.message }),
  );

/**
 * The note's agent actions first (session context, delegate), then housekeeping (tags, pin, more),
 * and the file path agents edit.
 */
export function NoteMetaBar({
  note,
  onChange,
  onDelete,
  onAddToCanvas,
  onDelegate,
  delegating,
  blocked,
  topLevel,
}: {
  note: NoteMeta;
  onChange: (flags: Partial<NoteFlags>) => void;
  onDelete?: () => void;
  /** Adds the note to its project's canvas as a text card. */
  onAddToCanvas?: () => void;
  onDelegate?: () => void;
  delegating?: boolean;
  /** Delegation can't run right now (an unresolved conflict, an unreadable file). */
  blocked?: boolean;
  /** A top-level note: its items are relayed across projects, with a plan to approve. */
  topLevel?: boolean;
}) {
  const desktop = useIsDesktop();
  const memory = note.id === MEMORY_NOTE_ID;
  const joined = note.tags.join(", ");
  const [tags, setTags] = useState(joined);
  const [synced, setSynced] = useState(joined);
  // Pick up tag changes made elsewhere (an agent editing the frontmatter).
  if (synced !== joined) {
    setSynced(joined);
    setTags(joined);
  }

  const commitTags = () => {
    const next = [...new Set(tags.split(",").map((t) => t.trim()).filter(Boolean))];
    if (next.join() !== note.tags.join()) onChange({ tags: next });
  };

  const open = note.openTasks;
  const items = `${open} item${open === 1 ? "" : "s"}`;
  const delegateLabel = open ? `Relay ${items}` : "Relay";
  const delegateHint = !open
    ? "Add unchecked - [ ] items to relay them to agents"
    : topLevel
      ? "Thunk proposes which project gets each item. You approve the plan in your Inbox."
      : "The project's chief splits each unchecked item into its own task.";

  const housekeeping = (
    <>
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        onBlur={commitTags}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitTags())}
        placeholder="Add tags"
        aria-label="Tags, comma separated"
        className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-7 w-44 rounded-md border px-2 text-[11px] outline-none focus-visible:ring-2"
      />
      <Hint label={note.pinned ? "Unpin" : "Pin to the top of the list"}>
        <Button size="icon-sm" variant="ghost" aria-pressed={note.pinned} aria-label="Pin" onClick={() => onChange({ pinned: !note.pinned })} className={cn("size-7 border border-transparent", note.pinned && PRESSED)}>
          <PinIcon />
        </Button>
      </Hint>
      <DropdownMenu>
        <Hint label="More">
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More note actions" className="size-7">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void copyPath(note.path)}>
            <CopyIcon /> Copy file path
          </DropdownMenuItem>
          {onAddToCanvas && (
            <DropdownMenuItem onSelect={onAddToCanvas}>
              <ShapesIcon /> Add to Canvas
            </DropdownMenuItem>
          )}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2Icon /> Delete note
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-2">
      {memory ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <BrainIcon className="size-3" /> Memory · always in every session&apos;s system prompt. Agents read and edit it too.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Hint label={note.inject ? "On: new sessions here get the full note in their system prompt" : "Give new sessions here the full note in their system prompt"}>
            <button
              type="button"
              aria-pressed={note.inject}
              onClick={() => onChange({ inject: !note.inject })}
              className={cn(
                "focus-visible:ring-ring flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors outline-none focus-visible:ring-2",
                note.inject ? PRESSED : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <BrainIcon className="size-3" />
              {note.inject ? "In session context" : "Add to session context"}
            </button>
          </Hint>
          {note.scope.kind === "projects" && !topLevel && <WorkspaceLinks note={note} onChange={(workspaceIds) => onChange({ workspaceIds })} disabled={blocked} />}
          {onDelegate && (
            <Hint label={delegateHint}>
              {/* A span keeps the hint reachable while the button is disabled. */}
              <span tabIndex={!open ? 0 : undefined} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Button size="xs" variant="outline" className="h-7 text-[11px]" disabled={!open || delegating || blocked} onClick={onDelegate}>
                  <SendIcon />
                  {delegating ? "Sending…" : delegateLabel}
                </Button>
              </span>
            </Hint>
          )}
          <div className="ml-auto flex items-center gap-1">{desktop ? housekeeping : <MobileDrawer title="More">{<div className="flex flex-wrap items-center gap-1.5 p-4">{housekeeping}</div>}</MobileDrawer>}</div>
        </div>
      )}
      {note.source === "repo" && (
        <p className="text-muted-foreground text-[11px]">
          {note.id}.md · Edits save to the file in the repo.
          {note.titleInFile === false && <> Renaming adds a <code className="font-mono">title:</code> line to its frontmatter.</>}
        </p>
      )}
      <Hint label="Copy path">
        <button type="button" onClick={() => void copyPath(note.path)} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring max-w-full self-start truncate rounded-sm font-mono text-[10px] outline-none focus-visible:ring-2">
          {tildify(note.path)}
        </button>
      </Hint>
    </div>
  );
}
