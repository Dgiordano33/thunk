"use client";

import { projectSectionPath } from "@/lib/routes";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ActivityResponse, SearchResult } from "@/lib/ambient/types";
import { RUN_STATUS_LABELS, type RoutineRunActivity } from "@/lib/routines/types";
import { useNotificationsEvents } from "@/lib/store/notifications-store";
import { useIsMac } from "@/lib/capture/shortcut";
import { useAmbient } from "@/lib/store/ambient-store";
import { useSession } from "@/lib/store/session-store";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { canvasPath, pathsFor, projectPath, workspacePath } from "@/lib/routes";
import { Kbd } from "@/components/ui/kbd";
import { Hint } from "@/components/hint";
import { SETTINGS_PATH, SETTINGS_SECTIONS, settingsPath } from "@/components/settings/sections";

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** A run's session when it still exists, else the Workshop entry for its routine. */
function runHref(run: RoutineRunActivity, paths: ReturnType<typeof pathsFor>) {
  return run.sessionId && run.workspaceId ? paths.session(run.workspaceId, run.sessionId) : projectSectionPath(paths.project(run.projectId), "workshop", { routine: run.routineId });
}

/** Activity polling and ⌘K search, shown as a compact Search button: in the world map's HUD, or the sidebar's logo row. */
export function AmbientHub({ projects, variant = "sidebar" }: { projects: SidebarProject[]; variant?: "sidebar" | "hud" | "rail" }) {
  const router = useRouter();
  useNotificationsEvents();
  const mac = useIsMac();
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
      } else if ((event.metaKey || event.ctrlKey) && event.key === "," && !event.defaultPrevented) {
        event.preventDefault();
        setSearchOpen(false);
        router.push(SETTINGS_PATH);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

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
  const navigation: SearchResult[] = projects.flatMap((p) => [
    { id: p.id, label: p.name, detail: p.repos[0]?.path ?? "No repositories", href: projectPath(p), kind: "Project" },
    { id: `${p.id}:canvas`, label: "Canvas", detail: p.name, href: canvasPath(p), kind: "Project" },
    ...p.workspaces.map((w) => ({ id: w.id, label: w.name, detail: p.name, href: workspacePath(p, w), kind: "Workspace" })),
  ]).concat(SETTINGS_SECTIONS.map((s) => ({ id: `settings:${s.id}`, label: s.label, detail: s.blurb, href: settingsPath(s.id), kind: "Settings" }))).filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));

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

  const keys = mac === false ? "Ctrl K" : "⌘K";
  if (variant === "rail") return (
    <>
      <Hint label="Search" keys={keys} side="right">
        <Button variant="ghost" size="icon" className="text-muted-foreground size-9" onClick={() => setSearchOpen(true)} aria-label={`Search (${keys})`}><SearchIcon /></Button>
      </Hint>
      {searchDialog}
    </>
  );
  return (
    <>
      <Button variant="ghost" size="sm" className={variant === "sidebar" ? "text-muted-foreground h-7 gap-1.5 px-2 text-xs" : "text-xs"} onClick={() => setSearchOpen(true)} aria-label={`Search (${keys})`}>
        <SearchIcon /> Search <Kbd>{keys}</Kbd>
      </Button>
      {searchDialog}
    </>
  );
}

/** Routine runs under way, and a note when activity polling fails. Lives under the sidebar's Inbox and Library rows. */
export function SidebarActivity({ projects }: { projects: SidebarProject[] }) {
  const activityError = useAmbient((s) => s.error);
  const runs = useAmbient((s) => s.runs).filter((r) => !r.error?.startsWith("Skipped"));
  if (!activityError && runs.length === 0) return null;
  return (
    <div className="px-2 pt-2">
      {activityError && <p role="status" className="text-destructive px-2 text-xs">Activity unavailable. Retrying…</p>}
      {runs.length > 0 && (
        <>
          <h2 className="text-muted-foreground px-2 pt-1 text-xs font-medium">Routines</h2>
          <ul className="mt-0.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {runs.map((r) => <li key={r.id}><Link href={runHref(r, pathsFor(projects))} title={r.routineName} className="hover:bg-sidebar-accent block rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring">
              <span className="block truncate font-medium">{r.routineName}</span>
              <span className="text-muted-foreground block truncate">{RUN_STATUS_LABELS[r.status]}{r.summary ? ` · ${r.summary.split("\n")[0]}` : r.error ? ` · ${r.error}` : ""}</span>
            </Link></li>)}
          </ul>
        </>
      )}
    </div>
  );
}
