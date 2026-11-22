"use client";

import { FloatingWindow } from "@/components/world/floating-window";

import { useIsDesktop } from "@/components/mobile/viewport";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { usePaths } from "@/components/layout/paths-context";
import { projectSectionPath } from "@/lib/routes";
import { PlusIcon, XIcon } from "lucide-react";
import { Hint } from "@/components/hint";
import { useStoredFlag } from "@/lib/client/use-stored-flag";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CivPanel } from "@/components/world/civ-panel";
import { api } from "@/lib/client/api";
import { parseScopeKey, scopeKey, sortNotes, type NoteFolder, type NoteMeta, type NoteScope } from "@/lib/notes/types";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { CollapsiblePane } from "./collapsible-pane";
import { BackToNotes, EmptyNote, ScopeNotes, useNoteActions } from "./library";
import { LibraryFolders } from "./library-folders";
import { NoteEditor } from "./note-editor";
import { NoteList } from "./note-list";

const LAST_NOTEBOOK_KEY = "thunk.notes.lastNotebook";
const HINT_DISMISSED_KEY = "thunk.notes.repoHintDismissed";

/** Every notebook across projects and workspaces, refetched on any note change. A failed load is an error, not an empty library. */
export function useAllNotes() {
  useNotesEvents();
  const rev = useNotesFeed((s) => s.rev);
  const [folders, setFolders] = useState<NoteFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.listAllNotes().then(
      (r) => { if (!cancelled) { setFolders(r.projects); setError(null); } },
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [rev, attempt]);
  const retry = useCallback(() => { setError(null); setAttempt((n) => n + 1); }, []);
  return { folders, error, retry };
}

/**
 * The global Library: folders → list → editor, Apple Notes style.
 * URL state: `?scope=p:<id>|w:<id>&note=<id>` so the town and sidebar can deep-link.
 */
export function NotesLibrary() {
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = parseScopeKey(params.get("scope"));
  const noteParam = params.get("note");
  const { folders, error, retry } = useAllNotes();

  const navigate = useCallback(
    (next: { scope: NoteScope | null; note: string | null }) => {
      const q = new URLSearchParams();
      if (next.scope) q.set("scope", scopeKey(next.scope));
      if (next.note) q.set("note", next.note);
      window.history.replaceState(null, "", q.size ? `${pathname}?${q}` : pathname);
    },
    [pathname],
  );

  const homeId = folders?.find((f) => f.home)?.project.id ?? null;
  const { label, projectOf } = useMemo(() => {
    const names = new Map<string, string>();
    const projects = new Map<string, string>();
    for (const f of folders ?? []) {
      const set = (key: string, name: string) => { names.set(key, name); projects.set(key, f.project.id); };
      set(scopeKey({ kind: "projects", id: f.project.id }), f.project.name);
      for (const r of f.repos) set(`r:${r.notebook.id}`, `${f.project.name} / ${r.notebook.label}`);
      for (const w of f.workspaces)
        set(scopeKey({ kind: "workspaces", id: w.workspace.id }), `${f.project.name} / ${w.workspace.slug === "main" ? "Local" : w.workspace.name}`);
    }
    return { label: names, projectOf: projects };
  }, [folders]);

  return (
    <FloatingWindow title="Notes" className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-10 flex flex-col md:inset-x-4 md:top-20" style={{ bottom: !desktop ? "calc(4rem + env(safe-area-inset-bottom))" : process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full min-h-0 flex-1" bodyClassName="flex h-full min-h-0 flex-col md:flex-row">
        <CollapsiblePane title="Notebooks" storageKey="thunk.notes.notebooksOpen" className="hidden w-60 md:flex">
          <LibraryFolders folders={error ? [] : folders} selected={scope} onSelect={(s) => navigate({ scope: s, note: null })} />
        </CollapsiblePane>
        {!desktop && !noteParam && <div className="p-2"><Select value={scope ? scopeKey(scope) : "all"} onValueChange={value => navigate({ scope: parseScopeKey(value), note: null })}><SelectTrigger aria-label="Notebook" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All notes</SelectItem>{[...label].map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent></Select></div>}
        {scope ? (
          <ScopeNotes
            key={scopeKey(scope)}
            scope={scope}
            selectedId={noteParam}
            onSelect={(id) => navigate({ scope, note: id })}
            listTitle={label.get(scopeKey(scope)) ?? "Notes"}
            topLevel={scope.kind === "projects" && scope.id === homeId}
          />
        ) : (
          <AllNotes folders={folders} error={error} onRetry={retry} homeId={homeId} selected={noteParam} label={label} projectOf={projectOf} onSelect={(s, id) => navigate({ scope: s, note: id })} />
        )}
      </CivPanel>
    </FloatingWindow>
  );
}

/** "All notes": every scope's notes in one list. Selection is `<scopeKey>/<noteId>`. */
function AllNotes({
  folders,
  error,
  onRetry,
  homeId,
  selected,
  label,
  projectOf,
  onSelect,
}: {
  folders: NoteFolder[] | null;
  error: string | null;
  onRetry: () => void;
  homeId: string | null;
  selected: string | null;
  label: Map<string, string>;
  /** Scope key → the project it belongs to. */
  projectOf: Map<string, string>;
  onSelect: (scope: NoteScope | null, note: string | null) => void;
}) {
  const paths = usePaths();
  const desktop = useIsDesktop();
  const notes = useMemo<NoteMeta[] | null>(
    () => (folders ? sortNotes(folders.flatMap((f) => [...f.notes, ...f.workspaces.flatMap((w) => w.notes), ...f.repos.flatMap((r) => r.notes)])) : null),
    [folders],
  );
  const keyOf = (n: NoteMeta) => `${scopeKey(n.scope)}/${n.id}`;
  const current = notes?.find((n) => keyOf(n) === selected) ?? null;
  const select = useCallback((key: string | null) => onSelect(null, key), [onSelect]);
  const { remove, create, dialog } = useNoteActions(null, select);

  // ⌘N and "start a new one" create in the notebook last picked from New note, else the top level.
  const createIn = useCallback((target: NoteScope) => {
    localStorage.setItem(LAST_NOTEBOOK_KEY, scopeKey(target));
    void create(target);
  }, [create]);
  const createDefault = useCallback(() => {
    const last = parseScopeKey(localStorage.getItem(LAST_NOTEBOOK_KEY));
    const target = last && label.has(scopeKey(last)) ? last : folders?.[0] ? { kind: "projects" as const, id: (folders.find((f) => f.home) ?? folders[0]).project.id } : null;
    if (target) void create(target);
  }, [create, folders, label]);

  const [hintDismissed, setHintDismissed] = useStoredFlag(HINT_DISMISSED_KEY, false);
  const currentProject = current ? projectOf.get(scopeKey(current.scope)) : undefined;
  const hintProject = (currentProject && currentProject !== homeId ? currentProject : null) ?? folders?.find((f) => !f.home)?.project.id;

  return (
    <div className="flex min-h-0 flex-1">
      {dialog}
      <CollapsiblePane title="All notes" className={desktop ? "w-72" : selected ? "hidden" : "w-full"}>
        {error ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium">Couldn&apos;t load your notes</p>
            <p className="text-muted-foreground text-xs">{error}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
          </div>
        ) : (
          <NoteList
            notes={notes}
            selectedId={selected}
            keyOf={keyOf}
            contextOf={(n) => label.get(scopeKey(n.scope)) ?? ""}
            onSelect={select}
            onCreate={createDefault}
            onDelete={(n) => void remove(n)}
            groupMemory
            createControl={<NewNoteMenu folders={folders} onCreate={createIn} />}
            emptyText="Notes are plans and reference that agents can read and write. Start one at the top level, or in a project or workspace."
          />
        )}
        {!hintDismissed && hintProject && (
          <div className="text-muted-foreground flex shrink-0 items-start gap-1 border-t px-3 py-2 text-xs">
            <p className="flex-1">Keep notes in your repo with notebooks in <Link className="underline underline-offset-2" href={projectSectionPath(paths.project(hintProject), "center")}>project settings</Link>.</p>
            <Hint label="Dismiss">
              <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setHintDismissed(true)}>
                <XIcon />
              </Button>
            </Hint>
          </div>
        )}
      </CollapsiblePane>
      <div className={!desktop && !selected ? "hidden" : "flex min-w-0 flex-1 flex-col"}>
        {!desktop && <BackToNotes onClick={() => select(null)} />}
        {current ? (
          <NoteEditor key={keyOf(current)} scope={current.scope} noteId={current.id} onDeleted={() => select(null)} topLevel={current.scope.kind === "projects" && current.scope.id === homeId} />
        ) : (
          <EmptyNote onCreate={folders?.length ? createDefault : undefined} />
        )}
      </div>
    </div>
  );
}

/** "New note" for the mixed list: pick which notebook the note goes in. */
function NewNoteMenu({
  folders,
  onCreate,
}: {
  folders: NoteFolder[] | null;
  onCreate: (scope: NoteScope) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={!folders?.length}>
          <PlusIcon /> New note
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>New note in…</DropdownMenuLabel>
        {folders?.map((f, i) => {
          const pScope: NoteScope = { kind: "projects", id: f.project.id };
          return (
            <div key={f.project.id}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => onCreate(pScope)}>
                <span className="truncate font-medium">{f.project.name}</span>
                {f.home && <span className="text-muted-foreground ml-auto text-[10px]">across projects</span>}
              </DropdownMenuItem>
              {f.repos.map(({ notebook }) => <DropdownMenuItem key={notebook.id} onSelect={() => onCreate({ kind: "repos", id: notebook.id })}>{notebook.label} · repo</DropdownMenuItem>)}
              {f.workspaces.map(({ workspace }) => {
                const wScope: NoteScope = { kind: "workspaces", id: workspace.id };
                return (
                  <DropdownMenuItem key={workspace.id} className="pl-5" onSelect={() => onCreate(wScope)}>
                    <span className="truncate">{workspace.slug === "main" ? "Local" : workspace.name}</span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
