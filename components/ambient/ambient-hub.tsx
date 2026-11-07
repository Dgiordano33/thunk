"use client";

import { BellIcon, ChartNoAxesColumnIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ActivitySession, SearchResult, UsageSummary } from "@/lib/ambient/types";
import { useAmbient } from "@/lib/store/ambient-store";
import { useSession } from "@/lib/store/session-store";
import type { SidebarProject } from "@/components/layout/app-sidebar";

const usd = (cost: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cost);

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function AmbientHub({ projects }: { projects: SidebarProject[] }) {
  const router = useRouter();
  const sessions = useAmbient((s) => s.sessions);
  const activityError = useAmbient((s) => s.error);
  const [searchOpen, setSearchOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [usage, setUsage] = useState<(UsageSummary & { persistent: boolean }) | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  useEffect(() => {
    try { setNotifications(localStorage.getItem("thunk.notifications") === "on"); } catch { /* Storage is optional. */ }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.defaultPrevented) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const seen = new Map<string, number>();
    let initialized = false;
    // shortcut: poll while the app is open; use push delivery if notifications must survive closing it.
    const poll = async () => {
      try {
        const data = await get<{ sessions: ActivitySession[] }>("/api/ambient/activity", controller.signal);
        if (stopped) return;
        useAmbient.setState({ sessions: data.sessions, error: null });
        for (const session of data.sessions) {
          const notice = session.notice;
          if (initialized && notice && notice.seq > (seen.get(session.id) ?? 0) && notifications && "Notification" in window && Notification.permission === "granted") {
            const href = `/w/${session.workspaceId}/s/${session.id}`;
            if (document.visibilityState !== "visible" || !document.hasFocus() || window.location.pathname !== href) {
              const notification = new Notification(`${session.projectName} · ${notice.message}`, {
                body: session.title || session.workspaceName,
                tag: `thunk-${session.id}`,
              });
              notification.onclick = () => { window.focus(); router.push(href); notification.close(); };
            }
          }
          seen.set(session.id, notice?.seq ?? 0);
        }
        initialized = true;
      } catch (error) {
        if (!stopped) useAmbient.setState({ error: error instanceof Error ? error.message : "Activity unavailable" });
      } finally {
        if (!stopped) timer = setTimeout(poll, 2500);
      }
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [notifications, router]);

  useEffect(() => {
    if (!searchOpen || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const data = await get<{ results: SearchResult[] }>(`/api/ambient/search?q=${encodeURIComponent(query.trim())}`, controller.signal);
        if (!controller.signal.aborted) setResults(data.results);
      } catch (error) {
        if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Search failed");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchOpen]);

  useEffect(() => {
    if (!usageOpen) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await get<UsageSummary & { persistent: boolean }>(`/api/ambient/usage?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, controller.signal);
        if (!controller.signal.aborted) { setUsage(data); setUsageError(null); }
      } catch (error) {
        if (!controller.signal.aborted) setUsageError(error instanceof Error ? error.message : "Usage unavailable");
      }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [usageOpen]);

  const toggleNotifications = async () => {
    if (notifications) {
      setNotifications(false);
      try { localStorage.setItem("thunk.notifications", "off"); } catch { /* Storage is optional. */ }
      setNotificationMessage(null);
      return;
    }
    if (!("Notification" in window)) { setNotificationMessage("Desktop notifications are unavailable in this browser."); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotificationMessage("Allow notifications in your browser settings to enable alerts."); return; }
      setNotifications(true);
      try { localStorage.setItem("thunk.notifications", "on"); } catch { /* Storage is optional. */ }
      setNotificationMessage(null);
    } catch { setNotificationMessage("Could not enable desktop notifications."); }
  };

  const navigate = (href: string) => {
    setSearchOpen(false);
    const docId = href.split("#doc-")[1];
    if (docId && useSession.getState().documents[docId]) useSession.getState().setActiveDocument(docId);
    router.push(href);
  };
  const attention = sessions.filter((s) => s.pending > 0 || s.status === "awaiting" || s.status === "error");
  const navigation: SearchResult[] = projects.flatMap((p) => [
    { id: p.id, label: p.name, detail: p.root, href: `/p/${p.id}`, kind: "Project" },
    ...p.workspaces.map((w) => ({ id: w.id, label: w.name, detail: p.name, href: `/w/${w.id}`, kind: "Workspace" })),
  ]).filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="border-b px-2 pb-3">
      <Button variant="ghost" className="w-full justify-start text-xs" onClick={() => setSearchOpen(true)}>
        <SearchIcon className="size-3.5" /> Search anything <kbd className="text-muted-foreground ml-auto">⌘K / Ctrl K</kbd>
      </Button>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={() => setUsageOpen(true)}><ChartNoAxesColumnIcon /> Usage</Button>
        <Button variant="ghost" size="sm" className="flex-1 text-xs" aria-pressed={notifications} onClick={toggleNotifications}><BellIcon /> Alerts {notifications ? "on" : "off"}</Button>
      </div>
      {notificationMessage && <p role="status" className="text-muted-foreground px-2 py-1 text-xs">{notificationMessage}</p>}
      <div className="mt-2 px-2">
        <h2 className="text-muted-foreground text-xs font-medium">Needs attention <span className="tabular-nums">{attention.length || ""}</span></h2>
        {activityError ? <p role="status" className="text-destructive mt-1 text-xs">Activity unavailable. Retrying…</p> : attention.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">All clear</p> : (
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {attention.map((s) => <li key={s.id}><Link href={`/w/${s.workspaceId}/s/${s.id}`} className="hover:bg-sidebar-accent block rounded-md py-1.5 text-xs">
              <span className="block truncate font-medium">{s.title || s.workspaceName}</span>
              <span className="text-muted-foreground block truncate">{s.projectName} · {s.status === "error" ? "Session error" : `${s.pending || 1} pending request${s.pending > 1 ? "s" : ""}`}</span>
            </Link></li>)}
          </ul>
        )}
      </div>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="gap-2 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Search Thunk</DialogTitle>
          <DialogDescription className="sr-only">Find projects, workspaces, session titles, prompts, and document content.</DialogDescription>
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search sessions, documents, projects…" value={query} maxLength={200} onValueChange={(value) => { setQuery(value); setResults([]); setSearchError(null); setSearching(Boolean(value.trim())); }} />
            <CommandList>
              <CommandEmpty>{searchError || (searching ? "Searching…" : "No results found.")}</CommandEmpty>
              <CommandGroup heading="Navigate">
                {!query && <CommandItem onSelect={() => { setSearchOpen(false); setUsageOpen(true); }}>View usage</CommandItem>}
                {navigation.map((item) => <CommandItem key={item.id} value={item.id} onSelect={() => navigate(item.href)}><span className="truncate">{item.label}</span><span className="text-muted-foreground ml-auto truncate text-xs">{item.kind} · {item.detail}</span></CommandItem>)}
              </CommandGroup>
              {query.trim() && <CommandGroup heading="Sessions & documents">
                {results.map((item) => <CommandItem key={item.id} value={item.id} onSelect={() => navigate(item.href)}><div className="min-w-0"><div className="truncate">{item.label}</div><p className="text-muted-foreground truncate text-xs">{item.detail}</p></div></CommandItem>)}
              </CommandGroup>}
            </CommandList>
          </Command>
          {query.trim() && <p role="status" className="text-muted-foreground px-2 text-xs">{searchError || (searching ? "Searching…" : `${results.length} content matches · showing up to 60`)}</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>Usage</DialogTitle>
          <DialogDescription>Agent-reported cost estimates, in USD. Subscription billing and Max plan limits are unavailable.</DialogDescription>
          {usageError && <p role="alert" className="text-destructive text-sm">{usageError}</p>}
          {!usage && !usageError && <p role="status">Loading usage…</p>}
          {usage && <>
            <div><p className="text-muted-foreground text-xs">Recorded total</p><p className="text-2xl font-semibold tabular-nums">{usd(usage.total)}</p></div>
            {!usage.persistent && <p className="text-muted-foreground text-xs">Memory mode: retained events from this server run only.</p>}
            <div className="grid max-h-80 gap-5 overflow-y-auto sm:grid-cols-2">
              <div><h3 className="mb-2 text-sm font-medium">By day · your time zone</h3><table className="w-full text-xs"><tbody>{usage.days.map((d) => <tr key={d.name}><th scope="row" className="py-1 text-left font-normal">{d.name}</th><td className="text-right tabular-nums">{usd(d.cost)}</td></tr>)}</tbody></table>{!usage.days.length && <p className="text-muted-foreground text-xs">No reported usage yet.</p>}</div>
              <div><h3 className="mb-2 text-sm font-medium">By workspace</h3><table className="w-full text-xs"><tbody>{usage.workspaces.map((w) => {
                const project = projects.find((p) => p.workspaces.some((item) => item.id === w.id));
                const name = project?.workspaces.find((item) => item.id === w.id)?.name || "Archived workspace";
                return <tr key={w.id}><th scope="row" className="py-1 text-left font-normal"><Link href={`/w/${w.id}`} onClick={() => setUsageOpen(false)} className="hover:underline">{name}</Link>{project && <span className="text-muted-foreground block">{project.name}</span>}</th><td className="text-right tabular-nums">{usd(w.cost)}</td></tr>;
              })}</tbody></table></div>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
