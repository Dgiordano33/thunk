"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ActivitySession, SearchResult } from "@/lib/ambient/types";
import { useAmbient } from "@/lib/store/ambient-store";
import { useSession } from "@/lib/store/session-store";
import type { SidebarProject } from "@/components/layout/app-sidebar";

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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const notifications = useAmbient((s) => s.notifications);

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
    <div>
      <div className="border-b px-4 pb-3">
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
      <div className="px-2 pt-3">
        <Button variant="outline" className="bg-background text-muted-foreground h-10 w-full justify-start gap-2 text-sm font-normal" onClick={() => setSearchOpen(true)}>
          <SearchIcon className="size-4" /> Search anything…
        </Button>
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
    </div>
  );
}
