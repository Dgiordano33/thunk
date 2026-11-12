"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ActivityResponse, SearchResult } from "@/lib/ambient/types";
import { RUN_STATUS_LABELS, type RoutineRunActivity } from "@/lib/routines/types";
import { useNotifications, useNotificationsEvents } from "@/lib/store/notifications-store";
import { useAmbient } from "@/lib/store/ambient-store";
import { useSession } from "@/lib/store/session-store";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { canvasPath, pathsFor, projectPath, workspacePath } from "@/lib/routes";

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** A run's session when it still exists, else the Workshop entry for its routine. */
function runHref(run: RoutineRunActivity, paths: ReturnType<typeof pathsFor>) {
  return run.sessionId && run.workspaceId ? paths.session(run.workspaceId, run.sessionId) : `${paths.project(run.projectId)}?building=workshop&routine=${run.routineId}`;
}

/** Activity polling and ⌘K search. `hud` renders only a compact search button, for the world map. */
export function AmbientHub({ projects, variant = "sidebar" }: { projects: SidebarProject[]; variant?: "sidebar" | "hud" }) {
  const router = useRouter();
  useNotificationsEvents();
  const notices = useNotifications((s) => s.items);
  const notificationError = useNotifications((s) => s.error);
  const activityError = useAmbient((s) => s.error);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
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
    const poll = async () => {
      try {
        const data = await get<ActivityResponse>("/api/ambient/activity", controller.signal);
        if (stopped) return;
        const next = { sessions: data.sessions, runs: data.runs ?? [], deliveries: data.deliveries ?? [], error: null };
        const current = useAmbient.getState();
        if (current.error || JSON.stringify([current.sessions, current.runs, current.deliveries]) !== JSON.stringify([next.sessions, next.runs, next.deliveries])) useAmbient.setState(next);
      } catch (error) {
        if (!stopped) useAmbient.setState({ error: error instanceof Error ? error.message : "Activity unavailable" });
      } finally {
        if (!stopped) timer = setTimeout(poll, document.visibilityState === "visible" ? 2500 : 30_000);
      }
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, []);

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

  const navigate = (href: string) => {
    setSearchOpen(false);
    const docId = href.split("#doc-")[1];
    if (docId && useSession.getState().documents[docId]) useSession.getState().setActiveDocument(docId);
    router.push(href);
  };
  const attention = notices.filter((n) => n.status === "open" && n.urgency === "action");
  const runs = useAmbient((s) => s.runs).filter((r) => !r.error?.startsWith("Skipped"));
  const navigation: SearchResult[] = projects.flatMap((p) => [
    { id: p.id, label: p.name, detail: p.repos[0]?.path ?? "No repositories", href: projectPath(p), kind: "Project" },
    { id: `${p.id}:canvas`, label: "Canvas", detail: p.name, href: canvasPath(p), kind: "Project" },
    ...p.workspaces.map((w) => ({ id: w.id, label: w.name, detail: p.name, href: workspacePath(p, w), kind: "Workspace" })),
  ]).filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));

  const searchDialog = (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="gap-2 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search Thunk</DialogTitle>
        <DialogDescription className="sr-only">Find projects, workspaces, session titles, prompts, and document content.</DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search sessions, documents, projects…" value={query} maxLength={200} onValueChange={(value) => { setQuery(value); setResults([]); setSearchError(null); setSearching(Boolean(value.trim())); }} />
          <CommandList>
            <CommandEmpty>{searchError || (searching ? "Searching…" : "No results found.")}</CommandEmpty>
            <CommandGroup heading="Navigate">
              {!query && <CommandItem onSelect={() => { setSearchOpen(false); useAmbient.setState({ usageOpen: true }); }}>View usage</CommandItem>}
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
  );

  if (variant === "hud") {
    return (
      <>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSearchOpen(true)}>
          <SearchIcon /> Search <kbd className="text-muted-foreground font-sans text-[10px]">⌘K</kbd>
        </Button>
        {searchDialog}
      </>
    );
  }

  return (
    <div>
      <div className="border-b px-4 pb-3">
        <h2 className="text-muted-foreground text-xs font-medium">Needs attention <span className="tabular-nums">{attention.length || ""}</span></h2>
        {notificationError ? <p role="status" className="text-destructive mt-1 text-xs">Inbox unavailable. Retrying…</p> : attention.length === 0 ? <p className="text-muted-foreground mt-1 text-xs">All clear</p> : (
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {attention.slice(0, 3).map((n) => <li key={n.id}><Link href={n.href} className="hover:bg-sidebar-accent block rounded-md py-1.5 text-xs">
              <span className="block truncate font-medium">{n.title}</span>
              <span className="text-muted-foreground block truncate">{projects.find((p) => p.id === n.projectId)?.name}</span>
            </Link></li>)}
          </ul>
        )}
        <Link href="/inbox" className="mt-2 block text-xs hover:underline">Open inbox</Link>
        {activityError && <p role="status" className="text-destructive mt-1 text-xs">Activity unavailable. Retrying…</p>}
      </div>
      {runs.length > 0 && (
        <div className="border-b px-4 py-3">
          <h2 className="text-muted-foreground text-xs font-medium">Routines</h2>
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {runs.map((r) => <li key={r.id}><Link href={runHref(r, pathsFor(projects))} className="hover:bg-sidebar-accent block rounded-md py-1.5 text-xs">
              <span className="block truncate font-medium">{r.routineName}</span>
              <span className="text-muted-foreground block truncate">{RUN_STATUS_LABELS[r.status]}{r.summary ? ` · ${r.summary.split("\n")[0]}` : r.error ? ` · ${r.error}` : ""}</span>
            </Link></li>)}
          </ul>
        </div>
      )}
      <div className="px-2 pt-3">
        <Button variant="outline" className="bg-background text-muted-foreground h-10 w-full justify-start gap-2 text-sm font-normal" onClick={() => setSearchOpen(true)}>
          <SearchIcon className="size-4" /> Search anything…
        </Button>
      </div>
      {searchDialog}
    </div>
  );
}
