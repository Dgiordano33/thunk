"use client";

import { ArchiveIcon, BrainIcon, FileTextIcon, NotebookTextIcon, PlusIcon, RepeatIcon, RefreshCwIcon, SquareCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { noteRefKey, useContextOptions } from "@/components/context/use-context-options";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/hint";
import { api } from "@/lib/client/api";
import { CONTEXT_GROUP_LABELS, CONTEXT_KIND_LABELS, contextGroup, type ContextGroup, type ContextKind, type ContextViewItem } from "@/lib/context/types";
import { OPEN_TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/tasks/types";
import { useSession } from "@/lib/store/session-store";

const ICONS: Record<ContextKind, typeof FileTextIcon> = {
  memory: BrainIcon,
  instructions: FileTextIcon,
  note: NotebookTextIcon,
  task: SquareCheckIcon,
  vault: ArchiveIcon,
  routine: RepeatIcon,
};

const GROUPS: ContextGroup[] = ["prompt", "attached", "fetched", "left_out"];

const GROUP_HINTS: Record<ContextGroup, string> = {
  prompt: "Built into the system prompt when the session started or resumed. Removing an item applies from the next start or resume, because the running prompt can't change.",
  attached: "Sent into the conversation after it started.",
  fetched: "Read by the agent from notes, memory or the Vault.",
  left_out: "Known to Thunk but not sent in full.",
};

const MODE_LABELS = { full: "Full", truncated: "Cut", index: "Listed", omitted: "Not sent" } as const;

type Action = "update" | "remove" | "keep";

/** What the open session was given, grouped by how it got there, with Attach, Send update and Remove. */
export function SessionContext() {
  const sessionId = useSession((s) => s.sessionId);
  const projectId = useSession((s) => s.meta?.projectId ?? null);
  const status = useSession((s) => s.status);
  const [items, setItems] = useState<ContextViewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!sessionId) return;
    api.sessionContext(sessionId).then((r) => { setItems(r.items); setError(null); }).catch((err: Error) => setError(err.message));
  }, [sessionId]);
  // Re-read when the session settles: a turn may have read or changed context.
  useEffect(() => { load(); }, [load, status]);

  const act = async (item: ContextViewItem, action: Action) => {
    if (!sessionId) return;
    setBusy(item.id);
    try {
      setItems((await api.contextItemAction(sessionId, item.id, action)).items);
      if (action === "update") toast.success(`Sent the new version of “${item.title}”`);
    } catch (err) {
      toast.error(action === "update" ? "Couldn't send the update" : "Couldn't change the item", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!sessionId) return <EmptyNote text="Open a session to see what it was given." />;
  if (error) return <EmptyNote text={`Couldn't load the context: ${error}`} />;
  if (!items) return <Loading />;

  const grouped = new Map<ContextGroup, ContextViewItem[]>();
  for (const item of items) grouped.set(contextGroup(item), [...(grouped.get(contextGroup(item)) ?? []), item]);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-center gap-2">
        {projectId && <AttachButton sessionId={sessionId} projectId={projectId} onAttached={setItems} />}
        <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">What this session was given and what was left out.</p>
        <Hint label="Refresh context">
          <Button variant="ghost" size="xs" type="button" aria-label="Refresh context" onClick={load} className="text-muted-foreground hover:text-foreground rounded p-1">
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </Hint>
      </div>
      {!items.length && <EmptyNote text="Nothing recorded for this session yet. Context is recorded from the next start or resume." />}
      {GROUPS.filter((g) => grouped.has(g)).map((group) => (
        <section key={group} aria-label={CONTEXT_GROUP_LABELS[group]} className="flex flex-col gap-1.5">
          <header className="flex items-baseline gap-2">
            <h3 className="pixel text-muted-foreground text-[11px] tracking-wider uppercase">{CONTEXT_GROUP_LABELS[group]}</h3>
            <span className="text-muted-foreground font-mono text-[11px] tabular-nums">{grouped.get(group)!.length}</span>
          </header>
          <p className="text-muted-foreground text-[11px]">{GROUP_HINTS[group]}</p>
          <ul className="flex flex-col gap-1">
            {grouped.get(group)!.map((item) => <ContextRow key={item.id} item={item} group={group} busy={busy === item.id} onAction={(a) => void act(item, a)} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ContextRow({ item, group, busy, onAction }: { item: ContextViewItem; group: ContextGroup; busy: boolean; onAction: (action: Action) => void }) {
  const Icon = ICONS[item.kind];
  const detail = [CONTEXT_KIND_LABELS[item.kind], group !== "left_out" && MODE_LABELS[item.mode], item.chars > 0 && `${item.chars.toLocaleString("en-US")} chars`].filter(Boolean).join(" · ");
  const removed = Boolean(item.removedAt);
  return (
    <li className="bg-background flex items-start gap-2.5 rounded-lg border px-2.5 py-2">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium" title={item.path ?? item.title}>{item.title}</p>
          {item.changedSince && !removed && (
            <span className="shrink-0 rounded-[4px] bg-[var(--status-attention-soft)] px-1.5 font-mono text-[10px] leading-4 tracking-[0.06em] text-[var(--status-attention-ink)] uppercase">
              Changed, not sent
            </span>
          )}
        </div>
        <p className="text-muted-foreground truncate text-[11px]">{detail}</p>
        {removed && !item.removalPending ? <p className="text-muted-foreground text-[11px]">Removed by you</p> : item.reason && <p className="text-muted-foreground text-[11px]">{item.reason}</p>}
        {item.removalPending && <p className="text-muted-foreground text-[11px]">Removed. Applies from the next start or resume; the running prompt can&apos;t change.</p>}
        {(item.canUpdate || item.canRemove) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.canUpdate && <Button size="xs" variant="outline" disabled={busy} onClick={() => onAction("update")} aria-label={`Send update of ${item.title}`}>Send update</Button>}
            {item.canRemove && (removed
              ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("keep")} aria-label={`Keep ${item.title}`}>Keep</Button>
              : <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("remove")} aria-label={`Remove ${item.title}`}>Remove</Button>)}
          </div>
        )}
      </div>
    </li>
  );
}

/** Pick a note, task or Vault item and send it into the running session. */
function AttachButton({ sessionId, projectId, onAttached }: { sessionId: string; projectId: string; onAttached: (items: ContextViewItem[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="outline" type="button"><PlusIcon /> Attach</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {open && <AttachList projectId={projectId} onPick={async (ref, title) => {
          setOpen(false);
          try {
            onAttached((await api.attachContext(sessionId, ref)).items);
            toast.success(`Attached “${title}”`);
          } catch (err) {
            toast.error("Couldn't attach", { description: (err as Error).message });
          }
        }} />}
      </PopoverContent>
    </Popover>
  );
}

function AttachList({ projectId, onPick }: { projectId: string; onPick: (ref: Parameters<typeof api.attachContext>[1], title: string) => void }) {
  const { notes, tasks, vault, loading } = useContextOptions(projectId);
  const groups = new Map<string, NonNullable<typeof notes>>();
  for (const n of notes ?? []) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  const openTasks = (tasks ?? []).filter((t) => OPEN_TASK_STATUSES.includes(t.status));
  return (
    <Command>
      <CommandInput placeholder="Search notes, open tasks and the Vault…" />
      <CommandList className="max-h-72">
        <CommandEmpty>{loading ? "Loading…" : "Nothing to attach."}</CommandEmpty>
        {[...groups].map(([group, options]) => (
          <CommandGroup key={group} heading={group}>
            {options.map((n) => (
              <CommandItem key={noteRefKey(n.ref)} value={`${noteRefKey(n.ref)} ${n.title}`} onSelect={() => onPick({ kind: "note", ...n.ref }, n.title)}>
                <NotebookTextIcon /> <span className="truncate">{n.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {openTasks.length > 0 && (
          <CommandGroup heading="Open tasks">
            {openTasks.map((t) => (
              <CommandItem key={t.id} value={`${t.id} ${t.title}`} onSelect={() => onPick({ kind: "task", id: t.id }, t.title)}>
                <SquareCheckIcon /> <span className="truncate">{t.title}</span>
                <span className="text-muted-foreground ml-auto text-[10px]">{TASK_STATUS_LABELS[t.status]}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {(vault ?? []).length > 0 && (
          <CommandGroup heading="Vault">
            {vault!.map((v) => (
              <CommandItem key={v.id} value={`${v.id} ${v.title}`} onSelect={() => onPick({ kind: "vault", id: v.id }, v.title)}>
                <ArchiveIcon /> <span className="truncate">{v.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function Loading() {
  return (
    <div className="p-6">
      <div role="status" aria-label="Loading" className="w-full space-y-2"><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <Empty className="gap-2 py-6"><EmptyDescription className="text-xs">{text}</EmptyDescription></Empty>;
}
