"use client";

import { Thoughts, ThoughtReview } from "@/components/capture/thoughts";
import { useCaptures } from "@/components/capture/use-captures";
import type { Capture } from "@/lib/capture/types";
import { FloatingWindow } from "@/components/world/floating-window";
import { DesktopAlerts } from "@/components/onboarding/desktop-alerts";
import Link from "next/link";
import {
  ArrowUpRightIcon, CheckCheckIcon, ChevronDownIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, CircleDotIcon, ClipboardListIcon, EllipsisIcon, FileTextIcon,
  GitMergeIcon, GitPullRequestIcon, HourglassIcon, InboxIcon, MessageSquareIcon, PanelBottomIcon, ReplyIcon, RocketIcon, ShieldQuestionIcon, SquareCheckIcon, SquareIcon, XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CivPanel } from "@/components/world/civ-panel";
import { PixelIcon } from "@/components/world/pixel-icon";
import { OrbitMark } from "@/components/space/orbit-mark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { relativeTime } from "@/components/session/labels";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { api } from "@/lib/client/api";
import { NOTIFICATION_LABELS, type Notification, type NotificationKind } from "@/lib/notifications/types";
import { refreshNotifications, useNotifications, useNotificationsEvents } from "@/lib/store/notifications-store";
import { Skeleton } from "@/components/ui/skeleton";
import { Kbd } from "@/components/ui/kbd";
import { Hint } from "@/components/hint";
import { MessageResponse } from "@/components/ai-elements/message";
import { QuickContext } from "./quick-context";
import { describe, destination, dismissScope, FAILED_KINDS, isDismissable, foldBySession, groupFollowups, isDecision, isExternal, kindCounts, nextDecision, nextFocus, plural, sectionOf, type Group } from "./model";

/** Group rows past this many fold behind "Show N more" so one noisy PR can't push decisions off screen. */
const GROUP_PREVIEW = 5;
/** Question options shown inline; the rest are answered in the session. */
const MAX_OPTIONS = 4;
/** Inbox buttons use the full-strength ring: the shared ring/50 measures ~2.1:1 on the glass panel. */
const RING = "focus-visible:ring-2 focus-visible:ring-ring";
const ICONS: Partial<Record<NotificationKind, LucideIcon>> = {
  permission: ShieldQuestionIcon, question: MessageSquareIcon, agent_request: MessageSquareIcon, plan: ClipboardListIcon, delegation_plan: ClipboardListIcon,
  worker_report: FileTextIcon, review_requested: GitPullRequestIcon, ci_stuck: HourglassIcon, session_stuck: HourglassIcon, deploy_ready: RocketIcon,
  pr_merged: GitMergeIcon, run_needs_attention: CircleDotIcon,
};
const iconFor = (n: Notification) => ICONS[n.kind] ?? (FAILED_KINDS.includes(n.kind) ? CircleAlertIcon : CheckIcon);
const ROW_SELECTOR = "[data-notification]";

function OpenLink({ n, className, tabIndex, children, ...rest }: { n: Notification; className?: string; tabIndex?: number; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  if (isExternal(n.href)) return <a href={n.href} target="_blank" rel="noreferrer" className={className} tabIndex={tabIndex} {...rest}>{children}<span className="sr-only"> (opens in a new tab)</span></a>;
  return <Link href={n.href} className={className} tabIndex={tabIndex} {...rest}>{children}</Link>;
}

export function Inbox({ projects }: { projects: SidebarProject[] }) {
  useNotificationsEvents();
  const items = useNotifications((s) => s.items);
  const counts = useNotifications((s) => s.counts);
  const loaded = useNotifications((s) => s.loaded);
  const feedError = useNotifications((s) => s.error);
  const before = useNotifications((s) => s.before);
  const search = useSearchParams();
  const [projectId, setProjectIdState] = useState(search.get("projectId") || "all");
  const [kind, setKindState] = useState(search.get("kind") || "all");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [reviewing, setReviewing] = useState<Set<string>>(() => new Set());
  const [context, setContext] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const captures = useCaptures();
  const [confirm, setConfirm] = useState<{ ids: string[]; decisions: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  /** Set while a decision is being answered or dismissed: when it leaves the list, the loop moves on to the next one. */
  const advance = useRef<{ id: string; decisions: string[] } | null>(null);
  /** A row to focus once it has rendered (the next decision, after the loop moves on). */
  const pendingFocus = useRef<string | null>(null);
  const [folds, setFolds] = useState<Set<string>>(() => new Set());
  const read = useRef(new Set<string>());

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value === "all") params.delete(key); else params.set(key, value);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };
  const setProjectId = (id: string) => { setProjectIdState(id); setParam("projectId", id); setSelected(new Set()); };
  const setKind = (k: string) => { setKindState(k); setParam("kind", k); setSelected(new Set()); };

  const live = items.filter((n) => n.status !== "dismissed" && !hidden.has(n.id));
  const scoped = live.filter((n) => projectId === "all" || n.projectId === projectId);
  const visible = scoped.filter((n) => kind === "all" || n.kind === kind);
  const decisions = visible.filter((n) => sectionOf(n) === "decision");
  // A ready thought is a Decision row, in time order with the rest; the Thoughts field above lists only the ones still under way.
  const readyCapture = (n: Notification): Capture | undefined => n.kind === "capture_ready" ? captures.rows.find((r) => r.status === "ready" && `capture:${r.id}` === n.subjectKey) : undefined;
  const inFeed = new Set(live.filter((n) => n.status === "open").map((n) => readyCapture(n)?.id).filter((id): id is string => !!id));
  const followups = visible.filter((n) => sectionOf(n) === "followup");
  const earlier = visible.filter((n) => sectionOf(n) === "earlier");
  const groups = groupFollowups(followups);
  const shownInGroup = (g: Group) => expanded.has(g.key) ? g.items : g.items.slice(0, GROUP_PREVIEW);
  const earlierFolds = foldBySession(earlier);
  const shownEarlier = earlierFolds.flatMap((f) => folds.has(f.lead.id) ? [f.lead, ...f.rest] : [f.lead]);
  const order = [...decisions, ...groups.flatMap(shownInGroup), ...shownEarlier].map((n) => n.id);
  const focusId = activeId && order.includes(activeId) ? activeId : order[0] ?? null;
  const kinds = kindCounts(scoped);
  const scope = dismissScope(visible);
  const followupScope = dismissScope(followups);
  const selectedProject = projects.find((p) => p.id === projectId);
  const hasFilters = projectId !== "all" || kind !== "all";
  const waiting = decisions.length + followups.length;

  useEffect(() => {
    const ids = items.filter((n) => !n.readAt && !read.current.has(n.id)).slice(0, 500).map((n) => n.id);
    if (!ids.length) return;
    ids.forEach((id) => read.current.add(id));
    void api.readNotifications(ids).then(refreshNotifications).catch(() => { ids.forEach((id) => read.current.delete(id)); });
  }, [items]);
  // After a dismissal, put focus on the row that took the dismissed row's place.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const target = focusId && list.current?.querySelector<HTMLElement>(`[data-id="${focusId}"]`);
    (target || list.current)?.focus();
  }, [focusId, order.length]);

  // The triage loop: once the decision just answered or dismissed has left, focus the next one with its context open.
  const decisionIds = decisions.map((n) => n.id).join(",");
  useEffect(() => {
    const from = advance.current;
    if (!from) return;
    const now = decisionIds ? decisionIds.split(",") : [];
    if (now.includes(from.id)) return;
    advance.current = null;
    const next = nextDecision(from.decisions, from.id, now);
    // The answered item drops to Earlier; close its panel there so the list stays quiet.
    setContext((s) => { const open = new Set(s); open.delete(from.id); if (next) open.add(next); return open; });
    if (!next) { setAnnouncement("No more decisions."); return; }
    setActiveId(next);
    pendingFocus.current = next;
  }, [decisionIds]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = list.current?.querySelector<HTMLElement>(`[data-id="${pendingFocus.current}"]`);
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });
  /** Arm the loop for a decision about to be answered; disarm if the answer fails. */
  const armAdvance = (n: Notification) => { if (isDecision(n)) advance.current = { id: n.id, decisions: decisions.map((d) => d.id) }; };
  const disarm = (n: Notification) => { if (advance.current?.id === n.id) advance.current = null; };

  const markPending = (ids: string[], on: boolean) => setPending((s) => { const next = new Set(s); ids.forEach((id) => on ? next.add(id) : next.delete(id)); return next; });
  async function dismiss(ids: string[], label: string) {
    if (!ids.length) return;
    refocus.current = Boolean(list.current?.contains(document.activeElement));
    setActiveId(nextFocus(order, ids, focusId));
    const single = ids.length === 1 ? visible.find((n) => n.id === ids[0]) : undefined;
    if (single) armAdvance(single);
    setHidden((s) => new Set([...s, ...ids]));
    setSelected((s) => { const next = new Set(s); ids.forEach((id) => next.delete(id)); return next; });
    setAnnouncement(`Dismissed ${label}.`);
    try {
      await (ids.length === 1 ? api.dismissNotification(ids[0]) : api.dismissNotifications(ids));
      void refreshNotifications();
      toast(`Dismissed ${label}`, { action: { label: "Undo", onClick: () => void undo(ids, label) } });
    } catch (err) {
      if (single) disarm(single);
      setHidden((s) => { const next = new Set(s); ids.forEach((id) => next.delete(id)); return next; });
      setAnnouncement(`Couldn’t dismiss ${label}.`);
      toast.error(`Couldn’t dismiss ${label}`, { description: (err as Error).message });
    }
  }
  async function undo(ids: string[], label: string) {
    try {
      const { notifications } = await api.restoreNotifications(ids);
      setHidden((s) => { const next = new Set(s); ids.forEach((id) => next.delete(id)); return next; });
      await refreshNotifications();
      const kept = ids.length - notifications.length;
      setAnnouncement(`Restored ${label}.`);
      if (kept) toast(`Restored ${notifications.length} of ${ids.length}`, { description: `${plural(kept, "item")} already came back as a newer notification.` });
    } catch (err) { toast.error(`Couldn’t restore ${label}`, { description: (err as Error).message }); }
  }
  async function act(n: Notification, action: Notification["actions"][number]) {
    markPending([n.id], true);
    armAdvance(n);
    try { await api.notificationAction(action); await refreshNotifications(); setAnnouncement(`${action.label}: done.`); }
    catch (err) { disarm(n); toast.error(`Couldn’t ${action.label.toLowerCase()}`, { description: (err as Error).message }); }
    finally { markPending([n.id], false); }
  }
  /** Bulk dismissal asks first when it would drop a decision an agent is waiting on. */
  function dismissMany(ids: string[]) {
    const chosen = visible.filter((n) => ids.includes(n.id) && n.status === "open");
    const { decisions: blocked } = dismissScope(chosen);
    if (blocked) setConfirm({ ids: chosen.map((n) => n.id), decisions: blocked });
    else void dismiss(chosen.map((n) => n.id), plural(chosen.length, "item"));
  }
  const toggleContext = (id: string) => setContext((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  /** Open an item's context with the cursor in its reply box. */
  const openReply = (id: string) => { setContext((s) => new Set([...s, id])); setReplyTo(id); };
  const clearReplyTo = useCallback(() => setReplyTo(null), []);
  const contextPanel = (n: Notification, lead: string) => context.has(n.id) && n.sessionId && (
    <QuickContext n={n} lead={lead} focusReply={replyTo === n.id} onFocused={clearReplyTo} onSend={() => armAdvance(n)} onSendFailed={() => disarm(n)}
      onReplied={(message, mode) => { if (mode === "message" && n.kind !== "agent_request") disarm(n); setAnnouncement(`${message}.`); void refreshNotifications(); }} />
  );
  const contextButton = (n: Notification, active: boolean, lead: string, labelled: boolean) => n.sessionId && (
    <Hint label={context.has(n.id) ? "Hide context" : "Quick context"} keys="c"><Button data-context size={labelled ? "default" : "icon"} variant="ghost" tabIndex={active ? 0 : -1} aria-expanded={context.has(n.id)}
      aria-label={`Quick context for “${lead}”`} className={cn("shrink-0", !labelled && "text-muted-foreground", context.has(n.id) && "bg-accent text-accent-foreground", RING)} onClick={() => toggleContext(n.id)}><PanelBottomIcon aria-hidden="true" />{labelled && "Context"}</Button></Hint>
  );
  const toggleSelect = (id: string) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [role=combobox], [contenteditable=true], [role=menu], [role=listbox], details > *:not(summary)")) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])];
    if (!rows.length) return;
    const index = Math.max(0, rows.findIndex((row) => row.contains(document.activeElement)));
    const row = rows[index];
    const id = row.dataset.id!;
    const onRow = target === row;
    const move = (to: number) => { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, to))].focus(); };
    if (e.key === "j" || e.key === "ArrowDown") move(index + 1);
    else if (e.key === "k" || e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home" && onRow) move(0);
    else if (e.key === "End" && onRow) move(rows.length - 1);
    else if (e.key === "o" || e.key === "Enter" && onRow) { e.preventDefault(); row.querySelector<HTMLElement>("[data-open]")?.click(); }
    else if (/^[1-9]$/.test(e.key)) {
      const button = row.querySelector<HTMLButtonElement>(`[data-action="${e.key}"]`);
      if (!button || button.disabled) return;
      e.preventDefault();
      button.click();
    }
    else if (e.key === "c" || e.key === "r") {
      if (!visible.find((v) => v.id === id)?.sessionId) return;
      e.preventDefault();
      if (e.key === "c") toggleContext(id); else openReply(id);
    }
    else if (e.key === "x" || e.key === " " && onRow) { const n = visible.find((v) => v.id === id); if (!n || !isDismissable(n)) return; e.preventDefault(); toggleSelect(id); }
    else if (e.key === "e") {
      e.preventDefault();
      if (selected.size) { dismissMany([...selected]); return; }
      const n = visible.find((v) => v.id === id);
      if (n && isDismissable(n)) void dismiss([id], `“${describe(n).lead}”`);
    } else if (e.key === "Escape" && selected.size) { e.preventDefault(); setSelected(new Set()); }
  }

  const meta = (n: Notification, withProject: boolean) => {
    const project = projects.find((p) => p.id === n.projectId);
    const workspace = project?.workspaces.find((w) => w.id === n.workspaceId);
    const { ref } = describe(n);
    return <>
      {ref && <span className="text-foreground/80 font-mono">{ref}</span>}
      {withProject && <span className="truncate">{project?.name || "Top level"}</span>}
      {workspace && <span className="hidden truncate sm:inline">{workspace.name}</span>}
      <time className="shrink-0 tabular-nums" dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relativeTime(n.createdAt)}</time>
    </>;
  };
  const selectBox = (n: Notification, active: boolean, lead: string) => isDismissable(n) && (
    <button type="button" tabIndex={active ? 0 : -1} aria-pressed={selected.has(n.id)} aria-label={`Select “${lead}”`} onClick={() => toggleSelect(n.id)}
      className={cn("text-muted-foreground hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-sm outline-none", RING, selected.has(n.id) && "text-foreground")}>
      {selected.has(n.id) ? <SquareCheckIcon aria-hidden="true" className="size-4" /> : <SquareIcon aria-hidden="true" className="size-4" />}
    </button>
  );
  const rowProps = (n: Notification, label: string) => ({
    "data-notification": true, "data-id": n.id, tabIndex: n.id === focusId ? 0 : -1, "aria-label": label,
    onFocus: () => setActiveId(n.id),
  });
  const dismissButton = (n: Notification, active: boolean, lead: string) => isDismissable(n) && (
    <Hint label="Dismiss" keys="e"><Button data-dismiss size="icon" variant="ghost" tabIndex={active ? 0 : -1} className={cn("text-muted-foreground shrink-0", RING)} aria-label={`Dismiss “${lead}”`} disabled={pending.has(n.id)} onClick={() => void dismiss([n.id], `“${lead}”`)}><XIcon /></Button></Hint>
  );

  /** A decision: the agent is blocked until someone answers. Full card, one attention edge, actions inline. */
  const decisionCard = (n: Notification) => {
    const project = projects.find((p) => p.id === n.projectId);
    const workspace = project?.workspaces.find((w) => w.id === n.workspaceId);
    const { lead, detail } = describe(n);
    const active = n.id === focusId;
    const Icon = iconFor(n);
    const isPlan = n.kind === "plan" || n.kind === "delegation_plan";
    const open = reviewing.has(n.id);
    const options = n.kind === "question" ? n.actions.slice(0, MAX_OPTIONS) : n.actions;
    const more = n.actions.length - options.length;
    const busy = pending.has(n.id);
    const tab = active ? 0 : -1;
    return (
      <article key={n.id} {...rowProps(n, `${NOTIFICATION_LABELS[n.kind]}: ${lead}`)} className={cn(
        "bg-background relative min-w-0 rounded-sm border border-l-2 border-l-[var(--status-attention)] px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5",
        selected.has(n.id) && "bg-accent/40",
      )}>
        <div className="flex gap-3 sm:gap-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-[var(--status-attention-soft)] text-[var(--status-attention-ink)]"><Icon aria-hidden="true" className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-foreground/80 font-medium">{NOTIFICATION_LABELS[n.kind]}</span>
              <span aria-hidden="true" className="text-muted-foreground/50">/</span>
              <span className="truncate">{project?.name || "Top level"}{workspace ? ` · ${workspace.name}` : ""}</span>
              <time className="ml-auto shrink-0 tabular-nums" dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relativeTime(n.createdAt)}</time>
            </div>
            <h3 className="text-[15px] leading-relaxed font-medium break-words">{lead}</h3>
            {detail && isPlan && open && <div className="doc-prose bg-muted/30 mt-3 max-h-[60vh] overflow-auto rounded-sm border p-4 text-sm"><MessageResponse>{detail}</MessageResponse></div>}
            {detail && !isPlan && <details className="group/detail mt-1.5">
              <summary className={cn("text-muted-foreground flex cursor-pointer list-none items-start gap-1 rounded-sm text-xs leading-relaxed outline-none [&::-webkit-details-marker]:hidden", RING)} tabIndex={tab}>
                <ChevronRightIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0 group-open/detail:rotate-90" />
                <span className={cn("line-clamp-2 group-open/detail:hidden", n.kind === "permission" && "font-mono")}>{detail}</span>
                <span className="hidden group-open/detail:inline">Hide details</span>
              </summary>
              <p className={cn("bg-muted/40 mt-2 max-h-72 overflow-auto rounded-sm border p-3 leading-relaxed whitespace-pre-wrap break-words", n.kind === "permission" ? "font-mono text-xs" : "text-sm")}>{detail}</p>
            </details>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isPlan && !open && <Hint label="Review plan" keys="1"><Button data-action="1" tabIndex={tab} className={RING} onClick={() => setReviewing((s) => new Set([...s, n.id]))}>Review plan</Button></Hint>}
              {(!isPlan || open) && options.map((action, i) => (
                <Hint key={i} label={action.label} keys={String(i + 1)}>
                  <Button data-action={i + 1} tabIndex={tab} className={RING} variant={n.kind === "question" || i > 0 ? "outline" : "default"} disabled={busy} onClick={() => void act(n, action)}>{action.label}</Button>
                </Hint>
              ))}
              {isPlan && open && <Button tabIndex={tab} variant="ghost" className={RING} onClick={() => setReviewing((s) => { const next = new Set(s); next.delete(n.id); return next; })}>Hide plan</Button>}
              {n.sessionId && <Button data-reply tabIndex={tab} variant={n.actions.length ? "ghost" : "default"} className={RING} onClick={() => openReply(n.id)}><ReplyIcon aria-hidden="true" />{n.kind === "question" && !n.actions.length ? "Answer" : "Reply"}</Button>}
              {contextButton(n, active, lead, true)}
              <Button asChild tabIndex={tab} variant={n.actions.length || n.sessionId ? "ghost" : "default"} className={RING}>
                <OpenLink n={n} data-open="">{more > 0 ? `${more} more options in session` : destination(n)}<ArrowUpRightIcon aria-hidden="true" /></OpenLink>
              </Button>
              <span className="ml-auto flex items-center gap-1">{selectBox(n, active, lead)}{dismissButton(n, active, lead)}</span>
            </div>
            {contextPanel(n, lead)}
          </div>
        </div>
      </article>
    );
  };
  /** A ready thought: what you said, what the worker assumed and did, and the one step it held back. */
  const thoughtCard = (n: Notification, row: Capture) => {
    const project = projects.find((p) => p.id === n.projectId);
    const active = n.id === focusId;
    const tab = active ? 0 : -1;
    const lead = row.title || row.text;
    const go = (action: string, text?: string) => { armAdvance(n); void captures.act(row.id, action, text); };
    return (
      <article key={n.id} {...rowProps(n, `${NOTIFICATION_LABELS[n.kind]}: ${lead}`)} className="bg-background relative min-w-0 rounded-sm border border-l-2 border-l-[var(--status-attention)] px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-foreground/80 font-medium">{NOTIFICATION_LABELS[n.kind]}</span>
          <span aria-hidden="true" className="text-muted-foreground/50">/</span>
          <span className="truncate">{project?.name || "Home"}{row.mode === "scout" ? " · scout" : ""}</span>
          <time className="ml-auto shrink-0 tabular-nums" dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relativeTime(n.createdAt)}</time>
        </div>
        <h3 className="text-[15px] leading-relaxed font-medium break-words">{lead}</h3>
        <ThoughtReview row={row} tab={tab} onRedirect={(text) => go("redirect", text)} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Hint label="Go ahead" keys="1"><Button data-action="1" tabIndex={tab} className={RING} onClick={() => go("continue")}>{row.next_step ? `Go ahead: ${row.next_step}` : "Go ahead"}</Button></Hint>
          <Hint label="Redirect" keys="2"><Button data-action="2" tabIndex={tab} variant="outline" className={RING} onClick={(e) => e.currentTarget.closest("article")?.querySelector<HTMLInputElement>("[data-redirect]")?.focus()}>Redirect…</Button></Hint>
          <Hint label="Discard" keys="3"><Button data-action="3" tabIndex={tab} variant="outline" className={RING} onClick={() => go("discard")}>Discard</Button></Hint>
          <Button tabIndex={tab} variant="ghost" className={RING} onClick={() => go("keep")}>Keep</Button>
          {contextButton(n, active, lead, true)}
          {row.session_id && row.workspace_id && <Button asChild tabIndex={tab} variant="ghost" className={RING}><Link data-open="" href={`/w/${row.workspace_id}/s/${row.session_id}`}>Open session<ArrowUpRightIcon aria-hidden="true" /></Link></Button>}
        </div>
        {contextPanel(n, lead)}
      </article>
    );
  };
  /** A one-line row for follow-ups and history: lead text, mono metadata, one named link out. */
  const lineRow = (n: Notification, withProject: boolean, fold?: { count: number; open: boolean; nested?: boolean }) => {
    const { lead, detail } = describe(n);
    const active = n.id === focusId;
    const Icon = iconFor(n);
    const failed = FAILED_KINDS.includes(n.kind);
    const open = n.status === "open" && n.urgency === "action";
    return (
      <article key={n.id} {...rowProps(n, `${NOTIFICATION_LABELS[n.kind]}: ${lead}`)} className={cn(
        "min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected.has(n.id) && "bg-accent/40", fold?.nested && "ml-6 border-l pl-2 sm:ml-7",
      )}>
        <div className="hover:bg-muted/40 flex min-h-11 min-w-0 items-center gap-2 rounded-sm px-1 py-1 sm:gap-3">
        {selectBox(n, active, lead) || <span className="size-8 shrink-0" />}
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", failed && open ? "text-destructive" : open ? "text-[var(--status-attention-ink)]" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1 py-1.5">
          <p className={cn("truncate text-[13px]", !open && "text-muted-foreground")} title={lead}>{kind === "all" && !open ? <span className="text-muted-foreground">{NOTIFICATION_LABELS[n.kind]} · </span> : null}{lead}</p>
          {detail && !open && <details className="group/detail">
            <summary className={cn("text-muted-foreground flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs outline-none [&::-webkit-details-marker]:hidden", RING)} tabIndex={active ? 0 : -1}>
              <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0 group-open/detail:rotate-90" /><span className="truncate group-open/detail:hidden">{detail}</span><span className="hidden group-open/detail:inline">Hide details</span>
            </summary>
            <p className="bg-muted/40 mt-2 mb-1 max-h-72 overflow-auto rounded-sm border p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{detail}</p>
          </details>}
        </div>
        <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-[11px]">{meta(n, withProject)}</span>
        {fold && fold.count > 0 && <Button size="sm" variant="ghost" tabIndex={active ? 0 : -1} aria-expanded={fold.open} aria-label={`${fold.open ? "Hide" : "Show"} ${plural(fold.count, "earlier update")} from this session`}
          className={cn("text-muted-foreground h-8 shrink-0 font-mono text-[11px] tabular-nums", RING)} onClick={() => setFolds((s) => { const next = new Set(s); if (next.has(n.id)) next.delete(n.id); else next.add(n.id); return next; })}>
          +{fold.count}<ChevronDownIcon aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none", fold.open && "rotate-180")} /></Button>}
        {contextButton(n, active, lead, false)}
        <Button asChild size="sm" variant="ghost" tabIndex={active ? 0 : -1} className={cn("hidden h-8 shrink-0 sm:inline-flex", RING)}>
          <OpenLink n={n} data-open="">{destination(n)}<ArrowUpRightIcon aria-hidden="true" /></OpenLink>
        </Button>
        {dismissButton(n, active, lead) || <span className="size-8 shrink-0" />}
        </div>
        {context.has(n.id) && n.sessionId && <div className="pb-3 pl-10 pr-1 sm:pl-11">{contextPanel(n, lead)}</div>}
      </article>
    );
  };

  const scopeButton = (id: string, label: string, count: number) => (
    <button key={id} type="button" aria-pressed={projectId === id} onClick={() => setProjectId(id)} className={cn(
      "flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-xs outline-none", RING,
      projectId === id ? "bg-[color-mix(in_oklch,var(--w-bronze)_15%,transparent)] ring-1 ring-inset ring-[var(--w-bronze)]" : "text-muted-foreground hover:bg-muted hover:text-foreground",
    )}>
      {id === "all" ? <InboxIcon aria-hidden="true" className="size-4 shrink-0" /> : <PixelIcon name="castle" className="size-4 shrink-0" />}
      <span className="truncate">{label}</span>
      {count > 0 && <span className="ml-auto rounded-sm bg-[var(--status-attention-soft)] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[var(--status-attention-ink)] tabular-nums">{count}<span className="sr-only"> need attention</span></span>}
    </button>
  );
  const countBadge = (count: number) => <span className="text-muted-foreground font-mono text-[11px] tabular-nums">{count}</span>;
  const compact = loaded && visible.length > 0;
  const statusText = feedError ? "Live updates paused" : !loaded ? "Connecting…" : waiting
    ? [decisions.length && plural(decisions.length, "decision"), followups.length && plural(followups.length, "follow-up")].filter(Boolean).join(" · ")
    : "All caught up";
  const kindLabel = kind === "all" ? "All kinds" : NOTIFICATION_LABELS[kind as NotificationKind] ?? "All kinds";

  return (
    <FloatingWindow title="Inbox" className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] md:inset-x-4 md:top-20 md:bottom-[var(--panel-bottom)] z-10 flex flex-col justify-center" style={{ "--panel-bottom": process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" } as React.CSSProperties}>
      <CivPanel className="w-full min-h-0 flex-1" bodyClassName="flex h-full min-h-0">
        <aside className="bg-muted/20 hidden w-52 shrink-0 flex-col border-r lg:flex" aria-label="Inbox projects">
          <div className="flex items-center gap-3 border-b px-5 py-5"><PixelIcon name="bell" className="size-7" /><span className="pixel text-lg">Inbox</span></div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Filter notifications by project">
            {scopeButton("all", "All projects", counts.action)}
            <p className="pixel text-muted-foreground mb-2 mt-7 px-3 text-[11px] tracking-widest uppercase">Your projects</p>
            <div className="space-y-1">{projects.map((p) => scopeButton(p.id, p.name, counts.byProject[p.id] ?? 0))}</div>
            {!projects.length && <p className="text-muted-foreground px-3 text-xs leading-relaxed">Your projects will appear here.</p>}
          </nav>
          <p className={cn("text-muted-foreground border-t px-5 pt-4 text-xs leading-relaxed", process.env.NODE_ENV === "development" ? "pb-20" /* clears the Next dev badge */ : "pb-4")}>Decisions stay until you answer or dismiss them. Follow-ups, like failed CI, clear themselves once fixed.</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Thoughts projects={projects} captures={captures} inFeed={inFeed} />
          <header className={cn("shrink-0 border-b px-5 sm:px-8", compact ? "py-3" : "pb-4 pt-5 sm:pt-7")}>
            <div className={cn("flex gap-x-4 gap-y-2", compact ? "flex-wrap items-center" : "items-start")}>
              <div className={cn("min-w-0", compact ? "flex items-baseline gap-3" : "flex-1")}>
                {!compact && <p className="pixel text-muted-foreground mb-1 text-[11px] tracking-widest uppercase">{selectedProject?.name || "Across your projects"}</p>}
                <h1 className={cn("pixel leading-tight", compact ? "text-xl" : "text-3xl")}>{compact && selectedProject ? selectedProject.name : "Requests & updates"}</h1>
                {!compact && <p className="text-muted-foreground mt-2 text-xs leading-relaxed">Pick up where your agents need you.</p>}
                {compact && <span className="text-muted-foreground flex items-center gap-2 text-xs"><span aria-hidden="true" className={cn("size-1.5 rounded-full", feedError ? "bg-destructive" : waiting ? "bg-[var(--status-attention)]" : "bg-emerald-600 dark:bg-emerald-400")} />{statusText}</span>}
              </div>
              <div className={cn("flex items-center gap-2", compact ? "ml-auto" : "")}>
                {compact && filters()}
                <DropdownMenu>
                  <Hint label="Inbox actions"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className={RING} aria-label="Inbox actions"><EllipsisIcon /></Button></DropdownMenuTrigger></Hint>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={!scope.count} onSelect={() => dismissMany(scope.ids)}><XIcon />{scope.count ? `Dismiss ${plural(scope.count, "item")} in this view` : "Nothing to dismiss in this view"}</DropdownMenuItem>
                    {scope.decisions > 0 && followupScope.count > 0 && <DropdownMenuItem onSelect={() => void dismiss(followupScope.ids, plural(followupScope.count, "follow-up"))}><XIcon />Dismiss {plural(followupScope.count, "follow-up")} only</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {!compact && <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground mr-auto flex items-center gap-2 text-xs"><span aria-hidden="true" className={cn("size-1.5 rounded-full", feedError ? "bg-destructive" : !loaded ? "bg-muted-foreground" : waiting ? "bg-[var(--status-attention)]" : "bg-emerald-600 dark:bg-emerald-400")} />{statusText}</span>
              {filters()}
            </div>}
          </header>
          {feedError && <div role="alert" className="bg-destructive/5 text-destructive flex shrink-0 items-center gap-3 border-b px-5 py-2 text-xs sm:px-8"><CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 flex-1">{/reconnect/i.test(feedError) ? feedError : "Couldn’t refresh the inbox. What you see may be out of date."}</span><Button size="sm" variant="ghost" className={RING} onClick={() => void refreshNotifications()}>Refresh now</Button></div>}
          {selected.size > 0 && <div className="bg-accent/30 flex shrink-0 items-center gap-3 border-b px-5 py-2 text-xs sm:px-8">
            <span className="font-medium">{selected.size} selected</span>
            <Button size="sm" variant="outline" className={RING} onClick={() => dismissMany([...selected])}>Dismiss {selected.size}</Button>
            <Button size="sm" variant="ghost" className={RING} onClick={() => setSelected(new Set())}>Clear</Button>
            <span className="text-muted-foreground ml-auto hidden sm:inline"><Kbd>e</Kbd> dismisses the selection · <Kbd>Esc</Kbd> clears it</span>
          </div>}
          <div ref={list} tabIndex={-1} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 outline-none sm:px-8" aria-label="Notifications">
            {!loaded && !feedError && <div role="status" aria-label="Loading inbox" className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="rounded-sm border p-5"><Skeleton className="mb-3 h-2 w-1/4" /><Skeleton className="h-3 w-2/3" /><Skeleton className="mt-4 h-6 w-20" /></div>)}<span className="sr-only">Loading inbox…</span></div>}
            {!loaded && feedError && <div className="flex min-h-full items-center justify-center py-6"><div className="max-w-sm text-center"><CircleAlertIcon aria-hidden="true" className="text-muted-foreground mx-auto mb-4 size-8" /><h2 className="pixel text-2xl">Your inbox couldn’t load.</h2><p className="text-muted-foreground mt-3 text-sm leading-relaxed">Try again in a moment. Your notifications will appear when the connection is restored.</p><Button className={cn("mt-5", RING)} variant="outline" onClick={() => void refreshNotifications()}>Try again</Button></div></div>}
            {loaded && !visible.length && <div className="flex min-h-full items-center justify-center py-4">
              <div className="max-w-sm text-center">
                <CivPanel parchment className="mx-auto mb-6 w-fit space:hidden" bodyClassName="p-5"><PixelIcon name="bell" className="size-14" /></CivPanel>
                <OrbitMark name="bell" className="mx-auto mb-5" />
                <p className="pixel text-muted-foreground mb-2 text-[11px] tracking-widest uppercase">{hasFilters ? "Nothing in this view" : "A quiet moment"}</p>
                <h2 className="pixel text-3xl">{hasFilters ? "No matching notifications" : "Nothing needs you right now."}</h2>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{hasFilters ? "Try another project or notification kind to see more of your inbox." : "When an agent needs a decision or has news to share, it will land here. You can get back to building."}</p>
                {!hasFilters && <DesktopAlerts />}
                {hasFilters ? <Button className={cn("mt-6", RING)} variant="outline" onClick={() => { setProjectId("all"); setKind("all"); }}>Clear filters</Button> : <Button asChild className={cn("mt-6", RING)} variant="outline"><Link href="/projects">Back to your projects <ArrowUpRightIcon aria-hidden="true" /></Link></Button>}
              </div>
            </div>}
            {loaded && visible.length > 0 && <>
              {(decisions.length > 0 || kind === "all") && <section aria-labelledby="decisions-heading">
                <div className="mb-3 flex items-center gap-3"><h2 id="decisions-heading" className="pixel text-sm tracking-wide">Decisions</h2>{countBadge(decisions.length)}<span className="bg-border h-px flex-1" /></div>
                <div className="space-y-3">{decisions.map((n) => { const row = readyCapture(n); return row ? thoughtCard(n, row) : decisionCard(n); })}</div>
                {!decisions.length && <p className="text-muted-foreground flex items-center gap-2 pb-2 text-xs"><CheckCheckIcon aria-hidden="true" className="size-4 text-emerald-700 dark:text-emerald-400" />No agent is waiting on a decision.</p>}
              </section>}
              {groups.length > 0 && <section className={cn(decisions.length > 0 || kind === "all" ? "mt-8" : "")} aria-labelledby="followups-heading">
                <div className="mb-1 flex items-center gap-3"><h2 id="followups-heading" className="pixel text-sm tracking-wide">Follow-ups</h2>{countBadge(followups.length)}<span className="bg-border h-px flex-1" /></div>
                {groups.map((g) => {
                  const shown = shownInGroup(g);
                  const project = projects.find((p) => p.id === g.projectId);
                  const label = `${g.label}${projectId === "all" ? ` in ${project?.name || "Top level"}` : ""}`;
                  return <div key={g.key} role="group" aria-label={`${label}, ${g.items.length}`} className="border-b py-2 last:border-0">
                    <div className="flex min-h-9 items-center gap-2 px-1 text-xs">
                      <span className="font-medium">{g.label}</span>
                      {projectId === "all" && <span className="text-muted-foreground truncate">{project?.name || "Top level"}</span>}
                      {countBadge(g.items.length)}
                      {g.items.length > 1 && <Button size="sm" variant="ghost" className={cn("text-muted-foreground ml-auto", RING)} onClick={() => void dismiss(g.items.map((n) => n.id), plural(g.items.length, g.label.toLowerCase()))} aria-label={`Dismiss all ${g.items.length}: ${label}`}>Dismiss {g.items.length}</Button>}
                    </div>
                    {shown.map((n) => lineRow(n, false))}
                    {g.items.length > shown.length && <Button size="sm" variant="ghost" className={cn("text-muted-foreground ml-10", RING)} onClick={() => setExpanded((s) => new Set([...s, g.key]))}>Show {g.items.length - shown.length} more</Button>}
                  </div>;
                })}
              </section>}
              {earlier.length > 0 && <section className="mt-8" aria-labelledby="earlier-heading">
                <div className="mb-1 flex items-center gap-3"><h2 id="earlier-heading" className="pixel text-muted-foreground text-sm tracking-wide">Earlier</h2><span className="bg-border h-px flex-1" /></div>
                {earlierFolds.map((f) => {
                  const open = folds.has(f.lead.id);
                  return <div key={f.lead.id} role={f.rest.length ? "group" : undefined} aria-label={f.rest.length ? `${describe(f.lead).lead} and ${plural(f.rest.length, "earlier update")}` : undefined}>
                    {lineRow(f.lead, projectId === "all", { count: f.rest.length, open })}
                    {open && f.rest.map((n) => lineRow(n, projectId === "all", { count: 0, open: false, nested: true }))}
                  </div>;
                })}
              </section>}
            </>}
            {before && <Button className={cn("mt-6", RING)} variant="outline" disabled={loadingMore} onClick={async () => {
              setLoadingMore(true);
              try {
                const data = await api.listNotifications(`status=all&limit=500&before=${encodeURIComponent(before.at)}&beforeId=${before.id}`);
                useNotifications.setState((s) => ({ items: [...s.items, ...data.notifications.filter((n) => !s.items.some((item) => item.id === n.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), before: data.notifications.length === 500 ? { at: data.notifications.at(-1)!.createdAt, id: data.notifications.at(-1)!.id } : null }));
              } catch (err) { toast.error("Couldn’t load earlier notifications", { description: (err as Error).message }); }
              finally { setLoadingMore(false); }
            }}>Load earlier notifications</Button>}
          </div>
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
          <footer className="text-muted-foreground hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2.5 text-[11px] sm:px-8 md:flex"><span><Kbd>j</Kbd> / <Kbd>k</Kbd> move</span><span><Kbd>x</Kbd> select</span><span><Kbd>e</Kbd> dismiss</span><span><Kbd>o</Kbd> open</span><span><Kbd>1</Kbd>–<Kbd>4</Kbd> answer</span><span><Kbd>c</Kbd> context</span><span><Kbd>r</Kbd> reply</span><span className="ml-auto">Shortcuts work while the list has focus</span></footer>
        </div>
      </CivPanel>
      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss {plural(confirm?.ids.length ?? 0, "item")}, including {plural(confirm?.decisions ?? 0, "decision")}?</AlertDialogTitle>
            <AlertDialogDescription>Dismissing a decision doesn’t answer it: the agent stays blocked until someone responds in its session. You can undo right after.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (confirm) void dismiss(confirm.ids, plural(confirm.ids.length, "item")); setConfirm(null); }}>Dismiss {confirm?.ids.length}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FloatingWindow>
  );

  function filters() {
    return <>
      <div className="lg:hidden"><Select value={projectId} onValueChange={setProjectId}><SelectTrigger size="sm" aria-label="Filter by project" className="max-w-44 text-xs"><SelectValue>{selectedProject?.name || "All projects"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
      <Select value={kind} onValueChange={setKind}>
        <SelectTrigger size="sm" aria-label="Filter by kind" className="w-44 text-xs"><SelectValue>{kindLabel}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All kinds</SelectItem>
          {kind !== "all" && !kinds.some((k) => k.kind === kind) && <SelectItem value={kind}>{kindLabel}</SelectItem>}
          {kinds.map((k) => <SelectItem key={k.kind} value={k.kind}><span className="flex w-full items-center gap-3">{NOTIFICATION_LABELS[k.kind]}<span className="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">{k.open ? `${k.open} open` : k.total}</span></span></SelectItem>)}
        </SelectContent>
      </Select>
    </>;
  }
}
