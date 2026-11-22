"use client";

import { CornerDownLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageResponse } from "@/components/ai-elements/message";
import { modelLabel, relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { Question, SessionState } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import type { ContextMessage, NotificationContext, ReplyMode } from "@/lib/notifications/context";
import type { Notification } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const RING = "focus-visible:ring-2 focus-visible:ring-ring";
/** While the agent is working, re-read the session so its answer shows up here without leaving the Inbox. */
const POLL_MS = 4000;
const SENT: Record<ReplyMode, string> = { answer: "Answer sent", deny: "Denied with your note", changes: "Changes requested", message: "Sent to the agent" };

function stateOf(state: SessionState | null, live: boolean): { label: string; dot: string } | null {
  if (!state) return null;
  if (state === "error") return { label: "Error", dot: "bg-[var(--status-error)]" };
  if (state === "closed" || !live) return { label: state === "closed" ? "Closed" : "Paused", dot: "bg-muted-foreground" };
  if (state === "awaiting") return { label: "Waiting on you", dot: "bg-[var(--status-attention)]" };
  if (state === "running" || state === "starting") return { label: "Working", dot: "bg-[var(--status-running)]" };
  return { label: "Idle", dot: "bg-[var(--status-ok)]" };
}
const working = (c: NotificationContext | null) => Boolean(c?.source.live && (c.source.state === "running" || c.source.state === "starting"));
/** A clamped preview is plain text, so drop the Markdown marks that would otherwise show as symbols. */
const plain = (text: string) => text.replace(/```[\s\S]*?```/g, " [code] ").replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "").replace(/(\*\*|__|`)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s*\n\s*/g, " · ").trim();
const eyebrow = "pixel text-muted-foreground text-[11px] tracking-widest uppercase";

/**
 * The expandable panel under an Inbox item: where the notification came from, what the agent was asked and has
 * been doing, what it needs, the last few messages, and a reply box that answers the agent in place.
 */
export function QuickContext({ n, lead, focusReply, onFocused, onReplied }: {
  n: Notification; lead: string; focusReply: boolean; onFocused: () => void; onReplied: (message: string) => void;
}) {
  const [ctx, setCtx] = useState<NotificationContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** The model-written summary, with the context state it was written for. */
  const [brief, setBrief] = useState<{ key: string; text: string | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const { context } = await api.notificationContext(n.id); setCtx(context); setError(null); }
    catch (err) { setError((err as Error).message); }
  }, [n.id]);
  // Re-read when the notification changes (answered, resolved) and on a slow tick while the agent works.
  useEffect(() => { void load(); }, [load, n.updatedAt]);
  const polling = working(ctx);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, load]);
  // The summary is written for a settled state: wait out a working agent rather than summarizing every step.
  const briefKey = ctx?.briefKey ?? null;
  useEffect(() => {
    if (!briefKey || polling) return;
    let stale = false;
    api.notificationBrief(n.id).then(({ brief: text, key }) => { if (!stale) setBrief({ key: key ?? briefKey, text }); })
      .catch(() => { if (!stale) setBrief({ key: briefKey, text: null }); });
    return () => { stale = true; };
  }, [briefKey, polling, n.id]);
  const last = ctx?.thread.at(-1);
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [last?.at, last?.text.length]);
  const ready = Boolean(ctx);
  useEffect(() => {
    if (!focusReply || !ready) return;
    box.current?.querySelector<HTMLElement>("textarea, button, input")?.focus();
    onFocused();
  }, [focusReply, ready, onFocused]);

  async function send(run: () => Promise<ReplyMode>) {
    setSending(true); setSendError(null);
    try {
      const mode = await run();
      setText("");
      toast(SENT[mode]);
      onReplied(SENT[mode]);
      await load();
    } catch (err) { setSendError((err as Error).message); }
    finally { setSending(false); }
  }
  const toRow = (el: HTMLElement) => el.closest<HTMLElement>("[data-notification]")?.focus();

  if (!ctx) return (
    <section aria-label={`Quick context for “${lead}”`} className="bg-muted/30 mt-3 rounded-sm border px-4 py-3">
      {error
        ? <p role="alert" className="text-muted-foreground flex items-center gap-3 text-xs">Couldn’t load the context. {error}<Button size="sm" variant="ghost" className={RING} onClick={() => void load()}>Try again</Button></p>
        : <div role="status" aria-label="Loading context" className="space-y-2"><Skeleton className="h-2 w-1/3" /><Skeleton className="h-2 w-2/3" /><Skeleton className="h-2 w-1/2" /></div>}
    </section>
  );

  const { source } = ctx;
  // A summary is on its way when this state has one to write and the one on screen (if any) is for an earlier state.
  const summarizing = Boolean(ctx.briefKey && !polling && brief?.key !== ctx.briefKey);
  const state = stateOf(source.state, source.live);
  const where = [source.project, source.workspace].filter(Boolean).join(" › ");
  const form = ctx.questions && (ctx.questions.items.length > 1 || ctx.questions.items[0]?.multiSelect) ? ctx.questions : null;
  const note = ctx.reply?.mode !== "message" ? null
    : !source.live ? "This session is paused. Sending resumes it."
    : polling || source.state === "awaiting" ? "The agent is busy. Your message waits for this turn to end." : null;

  return (
    <section aria-label={`Quick context for “${lead}”`} className="bg-muted/30 mt-3 min-w-0 rounded-sm border">
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 py-3 text-xs leading-relaxed">
        {(brief?.text || summarizing) && <>
          <dt className={eyebrow}>Summary</dt>
          <dd className="min-w-0" aria-busy={summarizing}>
            {brief?.text
              ? <p className={cn("text-foreground text-[13px] leading-relaxed break-words", summarizing && "opacity-60")}>{brief.text}</p>
              : <div role="status" aria-label="Writing a summary" className="space-y-1.5 py-1"><Skeleton className="h-2 w-11/12" /><Skeleton className="h-2 w-2/3" /></div>}
          </dd>
        </>}
        <dt className={eyebrow}>From</dt>
        <dd className="min-w-0">
          <span className="break-words">{where || "Top level"}{source.session ? <> › <span className="text-foreground font-medium">{source.session}</span></> : null}</span>
          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {state && <span className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("size-1.5 rounded-full", state.dot)} />{state.label}</span>}
            {source.origin && <span>{source.origin}</span>}
            {source.model && <span className="font-mono text-[11px]">{modelLabel(source.model)}</span>}
            {source.startedAt && <span>started {relativeTime(source.startedAt)}</span>}
            {source.turns > 0 && <span className="tabular-nums">{source.turns} {source.turns === 1 ? "turn" : "turns"}</span>}
          </span>
        </dd>
        {ctx.goal && <><dt className={eyebrow}>Asked to</dt><dd className="max-h-24 min-w-0 overflow-auto break-words whitespace-pre-wrap">{ctx.goal}</dd></>}
        <dt className={eyebrow}>Needs</dt>
        <dd className={cn("min-w-0 font-medium", ctx.blocking ? "text-[var(--status-attention-ink)]" : "text-foreground/80")}>{ctx.need}</dd>
        {(ctx.activity.length > 0 || ctx.files.length > 0) && <>
          <dt className={eyebrow}>Lately</dt>
          <dd className="text-muted-foreground min-w-0 space-y-0.5">
            {ctx.activity.map((a, i) => <p key={i} className="truncate font-mono text-[11px]" title={a}>{a}</p>)}
            {ctx.files.length > 0 && <p className="truncate" title={ctx.files.join("\n")}>Edited {ctx.files.length === 1 ? "1 file" : `${ctx.files.length} files`}: <span className="font-mono text-[11px]">{ctx.files.slice(-3).map((f) => f.split("/").pop()).join(", ")}</span></p>}
          </dd>
        </>}
      </dl>
      {ctx.thread.length > 0 && <div ref={thread} className="max-h-80 space-y-3 overflow-auto border-t px-4 py-3" role="log" aria-label="Recent conversation">
        {ctx.thread.map((m, i) => <Bubble key={`${m.at}-${i}`} m={m} latest={i === ctx.thread.length - 1} writing={Boolean(m.partial) && polling} />)}
        {polling && !last?.partial && <p className="text-muted-foreground flex items-center gap-2 text-xs"><span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-[var(--status-running)] motion-reduce:animate-none" />The agent is working…</p>}
      </div>}
      {ctx.reply && n.sessionId && <div ref={box} className="border-t px-4 py-3">
        {form
          ? <QuestionForm key={form.requestId} items={form.items} disabled={sending} onSubmit={(answers) => void send(async () => { await api.answer(n.sessionId!, { requestId: form.requestId, answers }); return "answer"; })} />
          : <form onSubmit={(e) => { e.preventDefault(); if (text.trim() && !sending) void send(async () => (await api.replyToNotification(n.id, text.trim())).mode); }}>
              <div className="flex items-end gap-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} disabled={sending} placeholder={ctx.reply.placeholder} aria-label={`${ctx.reply.send}: ${lead}`}
                  className="bg-background max-h-48 min-h-9 flex-1 rounded-sm py-1.5 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); toRow(e.currentTarget); }
                    else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
                  }} />
                <Button type="submit" className={cn("shrink-0", RING)} variant={ctx.reply.mode === "deny" ? "outline" : "default"} disabled={!text.trim() || sending}>{sending ? "Sending…" : ctx.reply.send}<CornerDownLeftIcon aria-hidden="true" /></Button>
              </div>
              <p className="text-muted-foreground mt-1.5 text-[11px]">{note ? `${note} ` : ""}<span className="hidden md:inline"><Kbd>Enter</Kbd> sends · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> adds a line · <Kbd>Esc</Kbd> returns to the list</span></p>
            </form>}
        {sendError && <p role="alert" className="text-destructive mt-1.5 text-xs">Couldn’t send: {sendError}</p>}
      </div>}
    </section>
  );
}

function Bubble({ m, latest, writing }: { m: ContextMessage; latest: boolean; writing: boolean }) {
  const you = m.role === "you";
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-1 flex items-center gap-2 text-[11px]">
        <span className="text-foreground/80 font-medium">{you ? "You" : "Agent"}</span>
        {m.at > 0 && <time dateTime={new Date(m.at).toISOString()}>{relativeTime(new Date(m.at).toISOString())}</time>}
        {writing && <span>still writing</span>}
      </p>
      {you
        ? <p className={cn("bg-accent/50 rounded-sm px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap", !latest && "line-clamp-3")}>{m.text}</p>
        : latest
          ? <div className="doc-prose text-[13px] leading-relaxed break-words"><MessageResponse>{m.text}</MessageResponse></div>
          : <p className="text-muted-foreground line-clamp-3 text-[13px] leading-relaxed break-words">{plain(m.text)}</p>}
    </div>
  );
}

/** Questions with several parts or several picks: choose options, write your own, or both. */
function QuestionForm({ items, disabled, onSubmit }: { items: Question[]; disabled: boolean; onSubmit: (answers: Record<string, string>) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  const answer = (q: Question) => [...(picked[q.question] ?? []), own[q.question]?.trim()].filter(Boolean).join(", ");
  const complete = items.every(answer);
  const toggle = (q: Question, label: string) => setPicked((p) => {
    const current = p[q.question] ?? [];
    return { ...p, [q.question]: current.includes(label) ? current.filter((l) => l !== label) : q.multiSelect ? [...current, label] : [label] };
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (complete && !disabled) onSubmit(Object.fromEntries(items.map((q) => [q.question, answer(q)]))); }}>
      {items.map((q) => (
        <fieldset key={q.question} className="min-w-0 space-y-2" disabled={disabled}>
          <legend className="text-[13px] leading-relaxed font-medium">{q.question}{q.multiSelect && <span className="text-muted-foreground font-normal"> · pick any</span>}</legend>
          <div className="flex flex-wrap gap-2">
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label);
              return <Button key={o.label} type="button" variant="outline" aria-pressed={on} title={o.description} onClick={() => toggle(q, o.label)}
                className={cn(RING, on && "border-ring bg-accent text-accent-foreground")}>{o.label}</Button>;
            })}
          </div>
          <Input value={own[q.question] ?? ""} onChange={(e) => setOwn((s) => ({ ...s, [q.question]: e.target.value }))} placeholder="Or write your own answer" aria-label={`Your own answer: ${q.question}`} className="bg-background h-8 rounded-sm text-sm"
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.currentTarget.closest<HTMLElement>("[data-notification]")?.focus(); } }} />
        </fieldset>
      ))}
      <Button type="submit" className={RING} disabled={!complete || disabled}>{disabled ? "Sending…" : items.length > 1 ? "Send answers" : "Send answer"}</Button>
    </form>
  );
}
