"use client";
import Link from "next/link";
import { ArrowUpRightIcon, CheckCheckIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, Clock3Icon, EllipsisIcon, InboxIcon, MessageSquareIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CivPanel } from "@/components/world/civ-panel";
import { PixelIcon } from "@/components/world/pixel-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { relativeTime } from "@/components/session/labels";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { api } from "@/lib/client/api";
import { NOTIFICATION_KINDS, NOTIFICATION_LABELS, type Notification } from "@/lib/notifications/types";
import { refreshNotifications, useNotifications, useNotificationsEvents } from "@/lib/store/notifications-store";

export function Inbox({ projects }: { projects: SidebarProject[] }) {
  useNotificationsEvents();
  const items = useNotifications((s) => s.items);
  const counts = useNotifications((s) => s.counts);
  const loaded = useNotifications((s) => s.loaded);
  const feedError = useNotifications((s) => s.error);
  const search = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("projectId") || "all");
  const [kind, setKind] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const read = useRef(new Set<string>());
  const before = useNotifications((s) => s.before);
  const filtered = items.filter((n) => n.status !== "dismissed" && (projectId === "all" || n.projectId === projectId) && (kind === "all" || n.kind === kind));
  const attention = filtered.filter((n) => n.status === "open" && n.urgency === "action");
  const earlier = filtered.filter((n) => n.status !== "open" || n.urgency !== "action");

  async function perform(work: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await work(); await refreshNotifications(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const ids = items.filter((n) => !n.readAt && !read.current.has(n.id)).slice(0, 500).map((n) => n.id);
    if (!ids.length) return;
    ids.forEach((id) => read.current.add(id));
    void api.readNotifications(ids).then(refreshNotifications).catch((err: Error) => {
      ids.forEach((id) => read.current.delete(id)); setError(err.message);
    });
  }, [items]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [role=combobox], [contenteditable=true], [role=dialog], [role=menu], [role=listbox]"))) return;
      const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-notification]") ?? [])];
      if (!rows.length || !["j", "k", "o", "e"].includes(e.key)) return;
      e.preventDefault();
      const index = rows.findIndex((row) => row.contains(document.activeElement));
      if (e.key === "j" || e.key === "k") rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "j" ? 1 : -1)))].focus();
      else if (e.key === "o") rows[Math.max(0, index)].querySelector<HTMLAnchorElement>("a")?.click();
      else rows[Math.max(0, index)].querySelector<HTMLButtonElement>("[data-dismiss]")?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const row = (n: Notification) => {
    const project = projects.find((p) => p.id === n.projectId);
    const workspace = project?.workspaces.find((w) => w.id === n.workspaceId);
    const needsYou = n.status === "open" && n.urgency === "action";
    const failed = ["turn_failed", "session_error", "run_failed", "ci_failed", "script_failed"].includes(n.kind);
    const Icon = n.kind === "permission" ? ShieldQuestionIcon : n.kind === "question" || n.kind === "agent_request" ? MessageSquareIcon : failed ? CircleAlertIcon : needsYou ? Clock3Icon : CheckIcon;
    return (
      <article key={n.id} data-notification tabIndex={0} aria-label={n.title} className={cn(
        "group focus-visible:ring-ring relative min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset",
        needsYou ? "bg-background rounded-sm border border-l-2 border-l-amber-500 px-4 py-4 sm:px-5" : "hover:bg-muted/40 border-b px-1 py-4 last:border-0",
      )}>
        <div className="flex gap-3 sm:gap-4">
          <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm", needsYou ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : failed ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}><Icon aria-hidden="true" className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span className={cn("font-medium", needsYou ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{NOTIFICATION_LABELS[n.kind]}</span>
              <span aria-hidden="true" className="text-muted-foreground/50">/</span>
              <span className="text-muted-foreground truncate">{project?.name || "Project"}{workspace ? ` · ${workspace.name}` : ""}</span>
              <time className="text-muted-foreground ml-auto shrink-0 tabular-nums" dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relativeTime(n.createdAt)}</time>
            </div>
            <Link href={n.href} className={cn("hover:text-primary inline-flex max-w-full items-start gap-2 leading-relaxed", needsYou ? "text-[15px] font-medium" : "text-[13px]")}>
              <span className="min-w-0 break-words">{n.title}</span><ArrowUpRightIcon aria-hidden="true" className="text-muted-foreground mt-1 size-3.5 shrink-0" />
            </Link>
            {n.detail && <details className="group/detail mt-1.5">
              <summary className="text-muted-foreground focus-visible:ring-ring flex cursor-pointer list-none items-start gap-1 rounded-sm text-xs leading-relaxed outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0 group-open/detail:rotate-90" /><span className="line-clamp-2 group-open/detail:hidden">{n.detail}</span>
                <span className="hidden group-open/detail:inline">Hide details</span>
              </summary>
              <p className="bg-muted/40 mt-2 max-h-72 overflow-auto rounded-sm border p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{n.detail}</p>
            </details>}
            {needsYou && <div className="mt-4 flex flex-wrap items-center gap-2">
              {n.actions.map((action, i) => <Button key={i} size="sm" variant={i === 0 ? "default" : "outline"} disabled={busy} onClick={() => void perform(() => api.notificationAction(action))}>{action.label}</Button>)}
              {!n.actions.length && <Button asChild size="sm"><Link href={n.href}>Take a look <ArrowUpRightIcon aria-hidden="true" /></Link></Button>}
              <Button data-dismiss size="sm" variant="ghost" className="text-muted-foreground ml-auto" disabled={busy} onClick={() => void perform(() => api.dismissNotification(n.id))}>Dismiss</Button>
            </div>}
            {!needsYou && n.status === "open" && <Button data-dismiss size="icon-xs" variant="ghost" className="text-muted-foreground mt-2" aria-label={`Dismiss ${n.title}`} disabled={busy} onClick={() => void perform(() => api.dismissNotification(n.id))}><XIcon /></Button>}
          </div>
        </div>
      </article>
    );
  };
  const selectedProject = projects.find((p) => p.id === projectId);
  const hasFilters = projectId !== "all" || kind !== "all";
  const openCount = projectId === "all" ? counts.action : counts.byProject[projectId] ?? 0;
  const scopeButton = (id: string, label: string, count: number) => (
    <button key={id} type="button" aria-pressed={projectId === id} onClick={() => setProjectId(id)} className={cn(
      "focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-xs outline-none focus-visible:ring-2",
      projectId === id ? "bg-[color-mix(in_oklch,var(--w-bronze)_15%,transparent)] ring-1 ring-inset ring-[var(--w-bronze)]" : "text-muted-foreground hover:bg-muted hover:text-foreground",
    )}>
      {id === "all" ? <InboxIcon aria-hidden="true" className="size-4 shrink-0" /> : <PixelIcon name="castle" className="size-4 shrink-0" />}
      <span className="truncate">{label}</span>
      {count > 0 && <span className="ml-auto rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 tabular-nums dark:text-amber-400">{count}<span className="sr-only"> need attention</span></span>}
    </button>
  );
  return (
    <main className="absolute inset-x-4 top-20 z-10 flex justify-center" style={{ bottom: process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full max-w-7xl" bodyClassName="flex h-full min-h-0">
        <aside className="bg-muted/20 hidden w-52 shrink-0 flex-col border-r lg:flex" aria-label="Inbox projects">
          <div className="flex items-center gap-3 border-b px-5 py-5"><PixelIcon name="bell" className="size-7" /><span className="pixel text-lg">Inbox</span></div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Filter notifications by project">
            {scopeButton("all", "All projects", counts.action)}
            <p className="pixel text-muted-foreground mb-2 mt-7 px-3 text-[11px] tracking-widest uppercase">Your projects</p>
            <div className="space-y-1">{projects.map((p) => scopeButton(p.id, p.name, counts.byProject[p.id] ?? 0))}</div>
            {!projects.length && <p className="text-muted-foreground px-3 text-xs leading-relaxed">Your projects will appear here.</p>}
          </nav>
          <div className="text-muted-foreground border-t px-5 pb-20 pt-4 text-[11px] leading-relaxed">Requests stay here until answered or dismissed.</div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b px-5 pb-4 pt-5 sm:px-8 sm:pt-7">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="pixel text-muted-foreground mb-1 text-[11px] tracking-widest uppercase">{selectedProject?.name || "Across your projects"}</p>
                <h1 className="pixel text-3xl leading-tight">Requests & updates</h1>
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">Pick up where your agents need you.</p>
              </div>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Inbox actions"><EllipsisIcon /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={busy} onSelect={() => void perform(() => api.readNotifications(items.filter((n) => !n.readAt).slice(0, 500).map((n) => n.id)))}><CheckCheckIcon />Mark all read</DropdownMenuItem>
                  <DropdownMenuItem disabled={busy} onSelect={() => void perform(() => api.dismissAllNotifications(projectId === "all" ? undefined : projectId))}><XIcon />Dismiss all{selectedProject ? ` in ${selectedProject.name}` : ""}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground mr-auto flex items-center gap-2 text-xs"><span aria-hidden="true" className={cn("size-1.5 rounded-full", feedError ? "bg-destructive" : !loaded ? "bg-muted-foreground" : openCount ? "bg-amber-500" : "bg-emerald-600 dark:bg-emerald-400")} />{feedError ? "Connection interrupted" : !loaded ? "Connecting…" : openCount ? `${openCount} waiting for you` : "All caught up"}</span>
              <div className="lg:hidden"><Select value={projectId} onValueChange={setProjectId}><SelectTrigger size="sm" aria-label="Filter by project" className="max-w-44 text-xs"><SelectValue>{selectedProject?.name || "All projects"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <Select value={kind} onValueChange={setKind}><SelectTrigger size="sm" aria-label="Filter by kind" className="w-40 text-xs"><SelectValue>{kind === "all" ? "All kinds" : NOTIFICATION_LABELS[kind as Notification["kind"]]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All kinds</SelectItem>{NOTIFICATION_KINDS.map((k) => <SelectItem key={k} value={k}>{NOTIFICATION_LABELS[k]}</SelectItem>)}</SelectContent></Select>
            </div>
          </header>
          {(error || feedError) && <div role="alert" className="bg-destructive/5 text-destructive flex shrink-0 items-center gap-3 border-b px-5 py-2 text-xs sm:px-8"><CircleAlertIcon className="size-4 shrink-0" /><span className="min-w-0 flex-1">{error || feedError}</span><Button size="sm" variant="ghost" onClick={() => void refreshNotifications()}>Retry</Button></div>}
          <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
            {!loaded && !feedError && <div role="status" aria-label="Loading inbox" className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="motion-safe:animate-pulse rounded-sm border p-5"><div className="bg-muted mb-3 h-2 w-1/4" /><div className="bg-muted h-3 w-2/3" /><div className="bg-muted mt-4 h-6 w-20" /></div>)}<span className="sr-only">Loading inbox…</span></div>}
            {!loaded && feedError && <div className="flex min-h-full items-center justify-center py-10"><div className="max-w-sm text-center"><CircleAlertIcon aria-hidden="true" className="text-muted-foreground mx-auto mb-4 size-8" /><h2 className="pixel text-2xl">Your inbox couldn’t load.</h2><p className="text-muted-foreground mt-3 text-sm leading-relaxed">Try again in a moment. Your notifications will appear when the connection is restored.</p><Button className="mt-5" variant="outline" onClick={() => void refreshNotifications()}>Try again</Button></div></div>}
            {loaded && !filtered.length && <div className="flex min-h-full items-center justify-center py-10">
              <div className="max-w-sm text-center">
                <CivPanel parchment className="mx-auto mb-6 w-fit" bodyClassName="p-5"><PixelIcon name="bell" className="size-14" /></CivPanel>
                <p className="pixel text-muted-foreground mb-2 text-[11px] tracking-widest uppercase">{hasFilters ? "Nothing in this view" : "A quiet moment"}</p>
                <h2 className="pixel text-3xl">{hasFilters ? "No matching notifications" : "Nothing needs you right now."}</h2>
                <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{hasFilters ? "Try another project or notification kind to see more of your inbox." : "When an agent needs a decision or has news to share, it will land here. You can get back to building."}</p>
                {hasFilters ? <Button className="mt-6" variant="outline" onClick={() => { setProjectId("all"); setKind("all"); }}>Clear filters</Button> : <Button asChild className="mt-6" variant="outline"><Link href="/">Back to your projects <ArrowUpRightIcon aria-hidden="true" /></Link></Button>}
              </div>
            </div>}
            {loaded && filtered.length > 0 && <>
              <section aria-labelledby="attention-heading">
                <div className="mb-4 flex items-center gap-3"><h2 id="attention-heading" className="pixel text-sm tracking-wide">Needs your attention</h2><span className="bg-amber-500/10 rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-amber-700 tabular-nums dark:text-amber-400">{attention.length}</span><span className="h-px flex-1 bg-border" /></div>
                <div className="space-y-3">{attention.map(row)}</div>
                {!attention.length && <p className="text-muted-foreground flex items-center gap-2 border-b pb-5 text-xs"><CheckCheckIcon aria-hidden="true" className="size-4 text-emerald-600 dark:text-emerald-400" />Nothing waiting on you. You’re all caught up.</p>}
              </section>
              {earlier.length > 0 && <section className="mt-9" aria-labelledby="earlier-heading"><div className="mb-1 flex items-center gap-3"><h2 id="earlier-heading" className="pixel text-muted-foreground text-sm tracking-wide">Earlier</h2><span className="bg-border h-px flex-1" /></div>{earlier.map(row)}</section>}
            </>}
            {before && <Button className="mt-6" variant="outline" disabled={busy} onClick={() => void perform(async () => {
              const data = await api.listNotifications(`status=all&limit=500&before=${encodeURIComponent(before.at)}&beforeId=${before.id}`);
              useNotifications.setState((s) => ({ items: [...s.items, ...data.notifications.filter((n) => !s.items.some((item) => item.id === n.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), before: data.notifications.length === 500 ? { at: data.notifications.at(-1)!.createdAt, id: data.notifications.at(-1)!.id } : null }));
            })}>Load earlier notifications</Button>}
          </div>
          <footer className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2.5 text-[10px] sm:px-8"><span><kbd className="font-mono">j</kbd> / <kbd className="font-mono">k</kbd> to move</span><span><kbd className="font-mono">o</kbd> to open</span><span><kbd className="font-mono">e</kbd> to dismiss</span><span className="ml-auto hidden sm:inline">Updates appear automatically</span></footer>
        </div>
      </CivPanel>
    </main>
  );
}
