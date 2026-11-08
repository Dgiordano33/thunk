"use client";

import { BrainIcon, ListChecksIcon, PinIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MEMORY_NOTE_ID, type NoteFlags, type NoteMeta } from "@/lib/notes/types";
import { cn } from "@/lib/utils";

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function Toggle({
  on,
  onClick,
  icon: Icon,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  icon: typeof PinIcon;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        "focus-visible:ring-ring flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors outline-none focus-visible:ring-2",
        on ? "border-foreground/30 bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}

/** Pin · Inject into sessions · Actionable, tags, and the file path agents edit. */
export function NoteMetaBar({
  note,
  onChange,
  onDelete,
}: {
  note: NoteMeta;
  onChange: (flags: Partial<NoteFlags>) => void;
  onDelete?: () => void;
}) {
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

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-2">
      {memory ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <BrainIcon className="size-3" /> Memory · always in every session&apos;s system prompt. Agents read and edit it too.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Toggle on={note.pinned} onClick={() => onChange({ pinned: !note.pinned })} icon={PinIcon} label="Pin" title="Keep at the top of the list" />
          <Toggle
            on={note.inject}
            onClick={() => onChange({ inject: !note.inject })}
            icon={BrainIcon}
            label="Inject into sessions"
            title="Put the full note in the system prompt of new sessions in this scope"
          />
          <Toggle
            on={note.actionable}
            onClick={() => onChange({ actionable: !note.actionable })}
            icon={ListChecksIcon}
            label="Actionable"
            title="Show unchecked - [ ] items as tasks you can send to a session"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={commitTags}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitTags())}
            placeholder="Tags, comma separated"
            aria-label="Tags"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring h-7 min-w-28 flex-1 rounded-md border px-2 text-[11px] outline-none focus-visible:ring-2"
          />
          {onDelete && (
            <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete note" title="Delete note">
              <Trash2Icon />
            </Button>
          )}
        </div>
      )}
      <p className="text-muted-foreground truncate font-mono text-[10px]" title={note.path}>
        {tildify(note.path)}
      </p>
    </div>
  );
}
