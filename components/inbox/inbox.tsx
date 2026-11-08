"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { relativeTime } from "@/components/session/labels";
import { STATUS_STYLE } from "@/components/routines/shared";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { api } from "@/lib/client/api";
import { NOTIFICATION_KINDS, NOTIFICATION_LABELS, type Notification } from "@/lib/notifications/types";
import { refreshNotifications, useNotifications, useNotificationsEvents } from "@/lib/store/notifications-store";

export function Inbox({ projects }: { projects: SidebarProject[] }) {
  useNotificationsEvents();
  const items = useNotifications((s) => s.items);
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
  const all = items;
  const filtered = all.filter((n) => n.status !== "dismissed" && (projectId === "all" || n.projectId === projectId) && (kind === "all" || n.kind === kind));
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
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [role=combobox], [contenteditable=true], [role=dialog]"))) return;
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
    return <article key={n.id} data-notification tabIndex={0} className="bg-background focus-visible:ring-ring rounded-lg border p-4 outline-none focus-visible:ring-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={n.urgency === "action" && n.status === "open" ? STATUS_STYLE.needs_attention.badge : STATUS_STYLE.cancelled.badge}>{NOTIFICATION_LABELS[n.kind]}</Badge>
        <span className="text-muted-foreground">{project?.name || "Project"}{workspace ? ` · ${workspace.name}` : ""}</span>
        <time className="text-muted-foreground ml-auto" dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relativeTime(n.createdAt)}</time>
      </div>
      <Link href={n.href} className="font-medium hover:underline">{n.title}</Link>
      {n.detail && <p className="text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm">{n.detail}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {n.status === "open" && n.actions.map((action, i) => <Button key={i} size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => api.notificationAction(action))}>{action.label}</Button>)}
        {n.status === "open" ? <Button data-dismiss size="sm" variant="ghost" disabled={busy} onClick={() => void perform(() => api.dismissNotification(n.id))}>Dismiss</Button> : <span className="text-muted-foreground text-xs">Resolved</span>}
      </div>
    </article>;
  };
  return <main className="h-full overflow-y-auto px-4 pb-28 pt-24 sm:px-8">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Inbox</h1>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => api.readNotifications(items.filter((n) => !n.readAt).slice(0, 500).map((n) => n.id)))}>Mark all read</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void perform(() => api.dismissAllNotifications(projectId === "all" ? undefined : projectId))}>Dismiss all</Button>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <Select value={projectId} onValueChange={setProjectId}><SelectTrigger aria-label="Filter by project" className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
        <Select value={kind} onValueChange={setKind}><SelectTrigger aria-label="Filter by kind" className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All kinds</SelectItem>{NOTIFICATION_KINDS.map((k) => <SelectItem key={k} value={k}>{NOTIFICATION_LABELS[k]}</SelectItem>)}</SelectContent></Select>
      </div>
      {(error || feedError) && <p role="alert" className="text-destructive mb-4">{error || feedError} <Button variant="ghost" onClick={() => void refreshNotifications()}>Retry</Button></p>}
      {!loaded && <p role="status">Loading inbox…</p>}
      <div ref={list} className="space-y-8">
        <section><h2 className="mb-3 font-medium">Attention · {attention.length}</h2><div className="space-y-3">{attention.map(row)}</div>{loaded && !attention.length && <p className="text-muted-foreground text-sm">All clear. Nothing needs your attention.</p>}</section>
        <section><h2 className="mb-3 font-medium">Earlier</h2><div className="space-y-3">{earlier.map(row)}</div>{loaded && !earlier.length && <p className="text-muted-foreground text-sm">Updates will appear here.</p>}</section>
      </div>
      {before && <Button className="mt-6" variant="outline" disabled={busy} onClick={() => void perform(async () => {
        const data = await api.listNotifications(`status=all&limit=500&before=${encodeURIComponent(before.at)}&beforeId=${before.id}`);
        useNotifications.setState((s) => ({ items: [...s.items, ...data.notifications.filter((n) => !s.items.some((item) => item.id === n.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), before: data.notifications.length === 500 ? { at: data.notifications.at(-1)!.createdAt, id: data.notifications.at(-1)!.id } : null }));
      })}>Load earlier notifications</Button>}
      <p className="text-muted-foreground mt-6 text-xs">j / k to move · o to open · e to dismiss</p>
    </div>
  </main>;
}
