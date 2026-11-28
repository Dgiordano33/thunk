"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { CheckIcon, CircleAlertIcon, FileTextIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { addedTexts, composeMemory } from "@/lib/memory/compose";
import type { MemoryReview } from "@/lib/memory/service";
import { MEMORY_KIND_LABELS, MEMORY_OP_LABELS, type MemoryItemChoice, type MemoryProposal, type MemoryProposalItem, type MemorySource } from "@/lib/memory/types";
import { projectPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

const MemoryDocument = dynamic(() => import("./memory-document").then((m) => m.MemoryDocument), {
  ssr: false,
  loading: () => <Skeleton role="status" aria-label="Loading editor" className="h-64" />,
});

type Choice = { decision: "accepted" | "rejected"; text: string; editing: boolean };
const ORIGINS: Record<MemoryProposal["origin"], string> = { harvest: "Harvest", upkeep: "Memory upkeep", agent: "Agent" };
const STATUS: Record<MemoryProposal["status"], string> = { open: "Waiting for review", applied: "Applied", rejected: "Rejected", empty: "Nothing to change" };
const SOURCE_LABELS: Record<MemorySource["type"], string> = { task: "Task", session: "Session", note: "Note", workspace: "Workspace" };

function Sources({ sources }: { sources: MemorySource[] }) {
  if (!sources.length) return <span className="text-muted-foreground">No sources</span>;
  return <ul className="flex flex-wrap gap-1.5" aria-label="Sources">{sources.map((s) => (
    <li key={`${s.type}:${s.id}`} className="bg-muted/50 rounded-sm border px-1.5 py-0.5 font-mono text-[11px]" title={s.id}>{SOURCE_LABELS[s.type]} · {s.label || s.id.slice(0, 8)}</li>
  ))}</ul>;
}

/** The change itself: removed text struck through, added text highlighted. */
function Change({ item, text }: { item: MemoryProposalItem; text: string }) {
  return <div className="space-y-1.5 font-mono text-xs leading-relaxed">
    {item.target && <p className="rounded-sm bg-[var(--status-error-soft)] px-2 py-1 whitespace-pre-wrap break-words line-through decoration-1"><span className="sr-only">Removed: </span>{item.target}</p>}
    {item.op !== "remove" && <p className="rounded-sm bg-[var(--status-running-soft)] px-2 py-1 whitespace-pre-wrap break-words"><span className="sr-only">Added: </span>{text}</p>}
  </div>;
}

/**
 * Review a memory proposal: accept, edit or reject each change, or edit the resulting MEMORY.md as a document, then
 * Apply. Shared by the Inbox's review page and the Harvest dialog.
 */
export function ProposalReview({ proposalId, onDone, compact = false }: { proposalId: string; onDone?: (status: MemoryProposal["status"]) => void; compact?: boolean }) {
  const [review, setReview] = useState<MemoryReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [mode, setMode] = useState<"items" | "document">("items");
  const [documentText, setDocumentText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((next: MemoryReview) => {
    setReview(next);
    // Default: accept what still applies, leave flagged items rejected until the person looks at them.
    const preview = composeMemory(next.memory, next.proposal.items.map((i) => ({ id: i.id, op: i.op, target: i.target, text: i.editedText ?? i.text })));
    setChoices(Object.fromEntries(next.proposal.items.map((item) => {
      const fits = preview.outcomes.find((o) => o.id === item.id)?.applied ?? false;
      const decision = item.decision !== "pending" ? item.decision : fits ? "accepted" : "rejected";
      return [item.id, { decision, text: item.editedText ?? item.text ?? "", editing: false }];
    })));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.getMemoryProposal(proposalId).then((r) => { if (!cancelled) load(r); }, (err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [proposalId, load]);

  const accepted = useMemo(() => review?.proposal.items.filter((i) => choices[i.id]?.decision === "accepted") ?? [], [review, choices]);
  const composeItems = useMemo(() => accepted.map((i) => ({ id: i.id, op: i.op, target: i.target, text: i.op === "remove" ? null : choices[i.id]?.text ?? i.text })), [accepted, choices]);
  const preview = useMemo(() => review ? composeMemory(review.memory, composeItems) : null, [review, composeItems]);
  const flagOf = (item: MemoryProposalItem) => preview?.outcomes.find((o) => o.id === item.id)?.flag ?? (choices[item.id]?.decision === "rejected" ? item.flag : null);
  const blocked = preview?.outcomes.some((o) => o.flag) ?? false;

  if (error) return <p role="alert" className="text-destructive flex items-center gap-2 text-sm"><CircleAlertIcon aria-hidden="true" className="size-4" />{error}</p>;
  if (!review || !preview) return <div role="status" aria-label="Loading proposal" className="space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  const { proposal } = review;
  const open = proposal.status === "open";
  const set = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const selection = (): MemoryItemChoice[] => proposal.items.map((i) => ({ id: i.id, decision: choices[i.id]?.decision ?? "rejected", ...(i.op !== "remove" ? { text: choices[i.id]?.text } : {}) }));

  const apply = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await api.applyMemoryProposal(proposal.id, { choices: selection(), memoryHash: review.memoryHash, ...(mode === "document" ? { document: documentText } : {}) });
      if (result.applied) {
        setReview({ ...review, proposal: result.proposal });
        toast.success("Project memory updated");
        onDone?.("applied");
      } else {
        load(result.review);
        setMode("items");
        setNotice(result.changed ? "Project memory changed since you opened this. Changes were matched again; the flagged ones no longer fit. Edit or reject them, then apply." : "Some changes no longer fit project memory. Edit or reject the flagged ones, then apply.");
      }
    } catch (err) { toast.error("Couldn’t apply the proposal", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try {
      const { proposal: next } = await api.rejectMemoryProposal(proposal.id);
      setReview({ ...review, proposal: next });
      onDone?.("rejected");
    } catch (err) { toast.error("Couldn’t reject the proposal", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return <div className="flex min-h-0 flex-col gap-4">
    <header className="space-y-1">
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        <span className="text-foreground/80 font-medium">{ORIGINS[proposal.origin]}</span>
        <span aria-hidden="true">/</span>
        <Link className="hover:underline" href={projectPath(review.project)}>{review.project.name}</Link>
        <time className="tabular-nums" dateTime={proposal.createdAt} title={new Date(proposal.createdAt).toLocaleString()}>{relativeTime(proposal.createdAt)}</time>
        <span className={cn("ml-auto rounded-sm border px-1.5 font-mono text-[10px] tracking-[0.06em] uppercase", open ? "border-[var(--status-attention)] text-[var(--status-attention-ink)]" : "text-muted-foreground")}>{STATUS[proposal.status]}</span>
      </p>
      {!compact && <h2 className="text-lg leading-snug font-medium">{proposal.summary || `${proposal.items.length} proposed ${proposal.items.length === 1 ? "change" : "changes"} to project memory`}</h2>}
      {compact && proposal.summary && <p className="text-sm">{proposal.summary}</p>}
    </header>
    {notice && <p role="status" className="flex items-start gap-2 rounded-sm bg-[var(--status-attention-soft)] p-3 text-sm"><CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--status-attention-ink)]" />{notice}</p>}

    {mode === "items" && <ol className="space-y-3" aria-label="Proposed changes">{proposal.items.map((item, n) => {
      const choice = choices[item.id];
      const flag = flagOf(item);
      const rejected = choice?.decision === "rejected";
      return <li key={item.id} className={cn("bg-background rounded-sm border p-4", flag && !rejected && "border-l-2 border-l-[var(--status-attention)]", rejected && "opacity-70")} aria-label={`Change ${n + 1}: ${MEMORY_OP_LABELS[item.op]}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{MEMORY_OP_LABELS[item.op]}</span>
          {item.kind && <span className="text-muted-foreground rounded-sm border px-1.5">{MEMORY_KIND_LABELS[item.kind]}</span>}
          {item.reviewAfter && <span className="text-muted-foreground">Review after {item.reviewAfter}</span>}
          {flag && <span className="flex items-center gap-1 text-[var(--status-attention-ink)]"><CircleAlertIcon aria-hidden="true" className="size-3.5" />{flag}</span>}
        </div>
        {choice?.editing && item.op !== "remove"
          ? <>{item.target && <Change item={{ ...item, op: "remove" }} text="" />}<Textarea aria-label="Edited text" className="mt-1.5 font-mono text-xs" value={choice.text} onChange={(e) => set(item.id, { text: e.target.value })} rows={Math.min(8, Math.max(2, choice.text.split("\n").length))} /></>
          : <Change item={item} text={choice?.text ?? item.text ?? ""} />}
        <p className="mt-2 text-sm leading-relaxed">{item.reason}</p>
        <div className="mt-2 text-xs"><Sources sources={item.sources} /></div>
        {open && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Decision">
          <Button size="sm" variant={choice?.decision === "accepted" ? "default" : "outline"} aria-pressed={choice?.decision === "accepted"} onClick={() => set(item.id, { decision: "accepted", editing: false })}><CheckIcon aria-hidden="true" />Accept</Button>
          {item.op !== "remove" && <Button size="sm" variant={choice?.editing ? "secondary" : "outline"} aria-pressed={choice?.editing} onClick={() => set(item.id, { decision: "accepted", editing: !choice?.editing })}><PencilIcon aria-hidden="true" />Edit</Button>}
          <Button size="sm" variant={rejected ? "secondary" : "outline"} aria-pressed={rejected} onClick={() => set(item.id, { decision: "rejected", editing: false })}><XIcon aria-hidden="true" />Reject</Button>
        </div>}
      </li>;
    })}</ol>}

    {mode === "document" && <section aria-label="Resulting project memory" className="space-y-2">
      <p className="text-muted-foreground text-xs leading-relaxed">MEMORY.md with the accepted changes. Added text is highlighted. Edit freely; Apply saves this document as project memory, formatted by the editor.</p>
      {accepted.some((i) => i.target) && <div className="space-y-1"><p className="text-xs font-medium">Removed or replaced</p>{accepted.filter((i) => i.target).map((i) => <p key={i.id} className="rounded-sm bg-[var(--status-error-soft)] px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words line-through decoration-1">{i.target}</p>)}</div>}
      <div className="bg-background rounded-sm border p-4"><MemoryDocument markdown={preview.content} added={addedTexts(composeItems, preview.outcomes)} onChange={setDocumentText} /></div>
    </section>}

    {open && <footer className="flex flex-wrap items-center gap-2 border-t pt-4">
      {mode === "items"
        ? <Button variant="ghost" disabled={busy || blocked || !accepted.length} onClick={() => setMode("document")}><FileTextIcon aria-hidden="true" />Edit as document</Button>
        : <Button variant="ghost" disabled={busy} onClick={() => setMode("items")}>Back to changes</Button>}
      <span className="text-muted-foreground text-xs">{accepted.length} of {proposal.items.length} accepted{blocked ? " · resolve flagged changes first" : ""}</span>
      <span className="ml-auto flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void reject()}>Reject all</Button>
        <Button disabled={busy || !accepted.length || (mode === "items" && blocked)} onClick={() => void apply()}>{busy && <Loader2Icon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Apply {mode === "document" ? "document" : `${accepted.length} ${accepted.length === 1 ? "change" : "changes"}`}</Button>
      </span>
    </footer>}
    {!open && <p className="text-muted-foreground border-t pt-4 text-sm">{proposal.status === "applied" ? "These changes are in project memory." : proposal.status === "rejected" ? "Project memory was left as it was." : "Nothing needed changing."}</p>}
  </div>;
}
