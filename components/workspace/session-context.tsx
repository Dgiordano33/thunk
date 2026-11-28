"use client";

import { ArchiveIcon, BrainIcon, FileTextIcon, NotebookTextIcon, RepeatIcon, RefreshCwIcon, SquareCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/hint";
import { api } from "@/lib/client/api";
import { CONTEXT_GROUP_LABELS, CONTEXT_KIND_LABELS, contextGroup, type ContextGroup, type ContextKind, type ContextViewItem } from "@/lib/context/types";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

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
  prompt: "Built into the system prompt when the session started or resumed.",
  attached: "Sent into the conversation after it started.",
  fetched: "Read by the agent from notes, memory or the Vault.",
  left_out: "Known to Thunk but not sent in full.",
};

const MODE_LABELS = { full: "Full", truncated: "Cut", index: "Listed", omitted: "Not sent" } as const;

/** What the open session was given, grouped by how it got there. */
export function SessionContext() {
  const sessionId = useSession((s) => s.sessionId);
  const status = useSession((s) => s.status);
  const [items, setItems] = useState<ContextViewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!sessionId) return;
    api.sessionContext(sessionId).then((r) => { setItems(r.items); setError(null); }).catch((err: Error) => setError(err.message));
  }, [sessionId]);
  // Re-read when the session settles: a turn may have read or changed context.
  useEffect(() => { load(); }, [load, status]);

  if (!sessionId) return <EmptyNote text="Open a session to see what it was given." />;
  if (error) return <EmptyNote text={`Couldn't load the context: ${error}`} />;
  if (!items) return <Loading />;
  if (!items.length) return <EmptyNote text="Nothing recorded for this session yet. Context is recorded from the next start or resume." />;

  const grouped = new Map<ContextGroup, ContextViewItem[]>();
  for (const item of items) grouped.set(contextGroup(item), [...(grouped.get(contextGroup(item)) ?? []), item]);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs">What this session was given and what was left out.</p>
        <Hint label="Refresh context">
          <Button variant="ghost" size="xs" type="button" aria-label="Refresh context" onClick={load} className="text-muted-foreground hover:text-foreground rounded p-1">
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </Hint>
      </div>
      {GROUPS.filter((g) => grouped.has(g)).map((group) => (
        <section key={group} aria-label={CONTEXT_GROUP_LABELS[group]} className="flex flex-col gap-1.5">
          <header className="flex items-baseline gap-2">
            <h3 className="pixel text-muted-foreground text-[11px] tracking-wider uppercase">{CONTEXT_GROUP_LABELS[group]}</h3>
            <span className="text-muted-foreground font-mono text-[11px] tabular-nums">{grouped.get(group)!.length}</span>
          </header>
          <p className="text-muted-foreground text-[11px]">{GROUP_HINTS[group]}</p>
          <ul className="flex flex-col gap-1">
            {grouped.get(group)!.map((item) => <ContextRow key={item.id} item={item} group={group} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ContextRow({ item, group }: { item: ContextViewItem; group: ContextGroup }) {
  const Icon = ICONS[item.kind];
  const detail = [CONTEXT_KIND_LABELS[item.kind], group !== "left_out" && MODE_LABELS[item.mode], item.chars > 0 && `${item.chars.toLocaleString("en-US")} chars`].filter(Boolean).join(" · ");
  return (
    <li className="bg-background flex items-start gap-2.5 rounded-lg border px-2.5 py-2">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={item.path ?? item.title}>{item.title}</p>
        <p className="text-muted-foreground truncate text-[11px]">{detail}</p>
        {item.reason && <p className="text-muted-foreground text-[11px]">{item.reason}</p>}
        {item.removalPending && <p className="text-muted-foreground text-[11px]">Removed. Applies from the next start or resume; the running prompt can&apos;t change.</p>}
      </div>
      {item.changedSince && (
        <span className={cn("shrink-0 rounded-[4px] px-1.5 font-mono text-[10px] leading-4 tracking-[0.06em] uppercase", "bg-[var(--status-attention-soft)] text-[var(--status-attention-ink)]")}>
          Changed, not sent
        </span>
      )}
    </li>
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
