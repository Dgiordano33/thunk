"use client";

import Link from "next/link";
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, FilePenLineIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CivPanel } from "@/components/world/civ-panel";
import { FloatingWindow, WindowControls, useWindowHandle } from "@/components/world/floating-window";
import { api } from "@/lib/client/api";
import type { PlanChangeReview } from "@/lib/sources/service";
import { criteriaToText, diffLines, parseCriteriaText, sourceLabel, type PlanChange, type PlanChangeChoice, type PlanChangeItem } from "@/lib/sources/types";
import type { Criterion } from "@/lib/tasks/types";
import { projectPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

type Choice = { decision: "approved" | "rejected"; editing: boolean; brief: string; criteria: string };
const STATUS: Record<PlanChange["status"], string> = { waiting: "Waiting for the chief", open: "Waiting for review", applied: "Applied", dismissed: "Set aside" };
const DELIVERY: Record<NonNullable<PlanChangeItem["delivery"]>, string> = { sent: "Sent to the running worker", queued: "The queued task starts with it", saved: "Saved on the task" };

/** The plan change review screen, opened from its Inbox card. A floating panel in Solar, a full pane in Vanilla. */
export function PlanChangePage({ changeId }: { changeId: string }) {
  const handle = useWindowHandle();
  return <FloatingWindow className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-col md:inset-x-auto md:left-[calc(50%-24rem)] md:top-20 md:bottom-4 md:w-3xl">
    <CivPanel className="min-h-0 flex-1" bodyClassName="flex h-full min-h-0 flex-col">
      <header {...handle} className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button asChild size="icon" variant="ghost" aria-label="Back to Inbox"><Link href="/inbox"><ArrowLeftIcon /></Link></Button>
        <FilePenLineIcon aria-hidden="true" className="text-muted-foreground size-4" />
        <h1 className="text-base font-medium">Plan changed</h1>
        <span className="ml-auto"><WindowControls /></span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"><PlanChangeReviewView changeId={changeId} /></div>
    </CivPanel>
  </FloatingWindow>;
}

/** The revision itself: removed lines struck through, added lines highlighted, hunks as muted rules. */
export function SourceDiff({ diff }: { diff: string }) {
  const lines = diffLines(diff);
  if (!lines.some((l) => l.kind === "add" || l.kind === "remove")) return <p className="text-muted-foreground text-xs">No text changes.</p>;
  return <pre className="bg-background max-h-80 overflow-auto rounded-sm border py-1 font-mono text-[11px] leading-relaxed">{lines.map((l, i) => (
    <span key={i} className={cn("block px-2 whitespace-pre-wrap break-words",
      l.kind === "add" && "bg-[var(--status-running-soft)]",
      l.kind === "remove" && "bg-[var(--status-error-soft)] line-through decoration-1",
      l.kind === "hunk" && "text-muted-foreground")}>
      {l.kind === "add" && <span className="sr-only">Added: </span>}{l.kind === "remove" && <span className="sr-only">Removed: </span>}{l.text}
    </span>
  ))}</pre>;
}

function CriteriaList({ criteria, label }: { criteria: Criterion[] | null; label: string }) {
  if (!criteria?.length) return <p className="text-muted-foreground text-xs">No criteria</p>;
  return <ul aria-label={label} className="space-y-0.5 text-xs">{criteria.map((c) => <li key={c.id}><span className="text-muted-foreground font-mono">{c.id} · {c.kind}</span> {c.text}</li>)}</ul>;
}

/**
 * Review the chief's proposed changes to the tasks a revised plan or note touches: approve, edit or reject each,
 * then Apply. Approved changes update the task and reach its work; nothing reaches a worker before that.
 */
export function PlanChangeReviewView({ changeId }: { changeId: string }) {
  const [review, setReview] = useState<PlanChangeReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getPlanChange(changeId).then((r) => {
      if (cancelled) return;
      setReview(r);
      setChoices(Object.fromEntries(r.change.items.filter((i) => i.affected).map((i) => {
        const task = r.tasks.find((t) => t.id === i.taskId);
        return [i.taskId, { decision: i.decision === "rejected" ? "rejected" : "approved", editing: false, brief: i.brief ?? "", criteria: criteriaToText(i.criteria ?? task?.criteria) }];
      })));
    }, (err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [changeId]);

  if (error) return <p role="alert" className="text-destructive flex items-center gap-2 text-sm"><CircleAlertIcon aria-hidden="true" className="size-4" />{error}</p>;
  if (!review) return <div role="status" aria-label="Loading plan change" className="space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  const { change, tasks } = review;
  const open = change.status === "open";
  const affected = change.items.filter((i) => i.affected);
  const unaffected = change.items.filter((i) => !i.affected);
  const label = sourceLabel(change.kind);
  const set = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const approved = affected.filter((i) => choices[i.taskId]?.decision === "approved");

  const selection = (): PlanChangeChoice[] => affected.map((item) => {
    const c = choices[item.taskId];
    if (c?.decision !== "approved") return { taskId: item.taskId, decision: "rejected" };
    const task = tasks.find((t) => t.id === item.taskId);
    const original = criteriaToText(item.criteria ?? task?.criteria);
    const editedBrief = c.brief.trim() && c.brief.trim() !== (item.brief ?? "").trim() ? { brief: c.brief.trim() } : {};
    const editedCriteria = c.criteria.trim() !== original.trim() ? { criteria: parseCriteriaText(c.criteria, item.criteria ?? task?.criteria) } : {};
    return { taskId: item.taskId, decision: "approved", ...editedBrief, ...editedCriteria };
  });
  const apply = async () => {
    setBusy(true);
    try {
      const { change: next } = await api.applyPlanChange(change.id, selection());
      setReview({ ...review, change: next });
      toast.success(`${approved.length} ${approved.length === 1 ? "task" : "tasks"} updated`);
    } catch (err) { toast.error("Couldn’t apply the changes", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };
  const dismiss = async () => {
    setBusy(true);
    try { const { change: next } = await api.dismissPlanChange(change.id); setReview({ ...review, change: next }); }
    catch (err) { toast.error("Couldn’t set the changes aside", { description: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return <div className="flex min-h-0 flex-col gap-4">
    <header className="space-y-1">
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        <span className="text-foreground/80 font-medium">Chief</span>
        <span aria-hidden="true">/</span>
        <Link className="hover:underline" href={projectPath(review.project)}>{review.project.name}</Link>
        <time className="tabular-nums" dateTime={change.createdAt} title={new Date(change.createdAt).toLocaleString()}>{relativeTime(change.createdAt)}</time>
        <span className={cn("ml-auto rounded-sm border px-1.5 font-mono text-[10px] tracking-[0.06em] uppercase", open ? "border-[var(--status-attention)] text-[var(--status-attention-ink)]" : "text-muted-foreground")}>{STATUS[change.status]}</span>
      </p>
      <h2 className="text-lg leading-snug font-medium break-words">“{change.sourceTitle}” is now {label} v{change.version}</h2>
      <p className="text-muted-foreground text-sm">The chief proposes {affected.length === 1 ? "a change" : "changes"} to {affected.length} of {change.items.length} open {change.items.length === 1 ? "task" : "tasks"}. Nothing reaches a worker until you apply.</p>
    </header>

    <details className="group/diff">
      <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden="true" className="size-3 group-open/diff:rotate-90" />What changed in the {label}
      </summary>
      <div className="mt-2"><SourceDiff diff={change.diff} /></div>
    </details>

    <ol className="space-y-3" aria-label="Proposed task changes">{affected.map((item) => {
      const task = tasks.find((t) => t.id === item.taskId);
      const choice = choices[item.taskId];
      const rejected = choice?.decision === "rejected";
      const decided = !open && item.decision !== "pending";
      return <li key={item.taskId} className={cn("bg-background rounded-sm border p-4", rejected && "opacity-70")} aria-label={`Task: ${item.title}`}>
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="text-[15px] font-medium">{task?.title ?? item.title}</span>
          {task?.status && <span className="text-muted-foreground">{task.status.replace("_", " ")}</span>}
          {decided && <span className={cn("ml-auto", item.decision === "approved" ? "status-cue is-pass" : "text-muted-foreground")}>{item.decision === "approved" ? `✓ Approved${item.delivery ? ` · ${DELIVERY[item.delivery]}` : ""}` : "Rejected"}</span>}
        </div>
        <p className="text-sm leading-relaxed">{item.summary}</p>
        {choice?.editing && open ? <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium" htmlFor={`brief-${item.taskId}`}>Brief</label>
          <Textarea id={`brief-${item.taskId}`} className="font-mono text-xs" rows={Math.min(14, Math.max(4, choice.brief.split("\n").length))} value={choice.brief} onChange={(e) => set(item.taskId, { brief: e.target.value })} />
          <label className="block text-xs font-medium" htmlFor={`criteria-${item.taskId}`}>Criteria <span className="text-muted-foreground font-normal">one per line, as kind: text (test, interaction, visual, source or other)</span></label>
          <Textarea id={`criteria-${item.taskId}`} className="font-mono text-xs" rows={Math.min(8, Math.max(2, choice.criteria.split("\n").length))} value={choice.criteria} onChange={(e) => set(item.taskId, { criteria: e.target.value })} />
        </div> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <section aria-label="Current brief" className="min-w-0 space-y-1.5">
            <h4 className="text-muted-foreground text-xs font-medium">Now</h4>
            <p className="bg-muted/30 max-h-48 overflow-auto rounded-sm border px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words">{item.previousBrief || "No brief"}</p>
            <CriteriaList criteria={item.previousCriteria} label="Current criteria" />
          </section>
          <section aria-label="Proposed brief" className="min-w-0 space-y-1.5">
            <h4 className="text-muted-foreground text-xs font-medium">{decided && item.decision === "approved" ? "Applied" : "Proposed"}</h4>
            <p className="max-h-48 overflow-auto rounded-sm border bg-[var(--status-running-soft)] px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words">{open ? choice?.brief || item.brief : item.brief}</p>
            {item.criteria === null && !(open && choice && choice.criteria.trim() !== criteriaToText(task?.criteria).trim())
              ? <p className="text-muted-foreground text-xs">Criteria unchanged</p>
              : <CriteriaList criteria={open && choice ? parseCriteriaText(choice.criteria, item.criteria ?? task?.criteria).map((c, i) => ({ id: c.id ?? `c${i + 1}`, text: c.text, kind: c.kind })) : item.criteria} label="Proposed criteria" />}
          </section>
        </div>}
        {open && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Decision for ${item.title}`}>
          <Button size="sm" variant={choice?.decision === "approved" && !choice.editing ? "default" : "outline"} aria-pressed={choice?.decision === "approved"} onClick={() => set(item.taskId, { decision: "approved", editing: false })}><CheckIcon aria-hidden="true" />Approve</Button>
          <Button size="sm" variant={choice?.editing ? "secondary" : "outline"} aria-pressed={choice?.editing} onClick={() => set(item.taskId, { decision: "approved", editing: !choice?.editing })}><PencilIcon aria-hidden="true" />Edit</Button>
          <Button size="sm" variant={rejected ? "secondary" : "outline"} aria-pressed={rejected} onClick={() => set(item.taskId, { decision: "rejected", editing: false })}><XIcon aria-hidden="true" />Reject</Button>
        </div>}
      </li>;
    })}</ol>

    {unaffected.length > 0 && <section aria-label="Unaffected tasks" className="space-y-1">
      <h3 className="text-muted-foreground text-xs font-medium">Unaffected</h3>
      <ul className="space-y-0.5 text-sm">{unaffected.map((i) => <li key={i.taskId}>{i.title} <span className="text-muted-foreground text-xs">· {i.summary}</span></li>)}</ul>
    </section>}

    {open ? <footer className="flex flex-wrap items-center gap-2 border-t pt-4">
      <span className="text-muted-foreground text-xs">{approved.length} of {affected.length} approved · approved changes go to running workers as an update</span>
      <span className="ml-auto flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void dismiss()}>Set aside</Button>
        <Button disabled={busy} onClick={() => void apply()}>{busy && <Loader2Icon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{approved.length ? `Apply ${approved.length} ${approved.length === 1 ? "change" : "changes"}` : "Reject all"}</Button>
      </span>
    </footer> : <p className="text-muted-foreground border-t pt-4 text-sm">{change.status === "applied" ? "Decided. The chief has the outcome." : "Set aside. Every task kept its brief."}</p>}
  </div>;
}
