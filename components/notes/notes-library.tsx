"use client";

import { useIsDesktop } from "@/components/mobile/viewport";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { usePaths } from "@/components/layout/paths-context";
import { projectSectionPath } from "@/lib/routes";
import { PlusIcon } from "lucide-react";
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
import { EmptyNote, ScopeNotes, useNoteActions } from "./library";
import { LibraryFolders } from "./library-folders";
import { NoteEditor } from "./note-editor";
import { NoteList } from "./note-list";

/** Every notebook across projects and workspaces, refetched on any note change. */
export function useAllNotes() {
  useNotesEvents();
  const rev = useNotesFeed((s) => s.rev);
  const [folders, setFolders] = useState<NoteFolder[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.listAllNotes().then((r) => !cancelled && setFolders(r.projects)).catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [rev]);
  return folders;
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
  const folders = useAllNotes();

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
  const label = useMemo(() => {
    const names = new Map<string, string>();
    for (const f of folders ?? []) {
      names.set(scopeKey({ kind: "projects", id: f.project.id }), f.project.name);
      for (const r of f.repos) names.set(`r:${r.notebook.id}`, `${f.project.name} / ${r.notebook.label}`);
      for (const w of f.workspaces)
        names.set(scopeKey({ kind: "workspaces", id: w.workspace.id }), `${f.project.name} / ${w.workspace.slug === "main" ? "Local" : w.workspace.name}`);
    }
    return names;
  }, [folders]);

  return (
    <main className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-10 flex md:inset-x-4 md:top-20" style={{ bottom: !desktop ? "calc(4rem + env(safe-area-inset-bottom))" : process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full" bodyClassName="flex h-full min-h-0 flex-col md:flex-row">
        <CollapsiblePane title="Notebooks" defaultOpen={false} className="hidden w-60 md:flex">
          <LibraryFolders folders={folders} selected={scope} onSelect={(s) => navigate({ scope: s, note: null })} />
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
          <AllNotes folders={folders} homeId={homeId} selected={noteParam} label={label} onSelect={(s, id) => navigate({ scope: s, note: id })} />
        )}
      </CivPanel>
    </main>
  );
}

/** "All notes": every scope's notes in one list. Selection is `<scopeKey>/<noteId>`. */
function AllNotes({
  folders,
  homeId,
  selected,
  label,
  onSelect,
}: {
  folders: NoteFolder[] | null;
  homeId: string | null;
  selected: string | null;
  label: Map<string, string>;
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

  return (
    <div className="flex min-h-0 flex-1">
      {dialog}
      <CollapsiblePane title="All notes" className={desktop ? "w-72" : selected ? "hidden" : "w-full"}>
        <NoteList
          notes={notes}
          selectedId={selected}
          keyOf={keyOf}
          contextOf={(n) => label.get(scopeKey(n.scope)) ?? ""}
          onSelect={select}
          onDelete={(n) => void remove(n)}
          createControl={<NewNoteMenu folders={folders} onCreate={(s) => void create(s)} />}
          emptyText="Notes are plans and reference that agents can read and write. Start one at the top level, or in a project or workspace."
        />
        {folders?.find((f) => !f.home) && <p className="px-3 py-2 text-xs text-muted-foreground">Keep notes in your repo with notebooks in <Link className="underline" href={projectSectionPath(paths.project(folders.find((f) => !f.home)!.project.id), "center")}>project settings</Link>.</p>}
      </CollapsiblePane>
      <div className={!desktop && !selected ? "hidden" : "flex min-w-0 flex-1 flex-col"}>
        {!desktop && <button className="min-h-11 border-b text-left px-4" onClick={() => select(null)}>← Notes</button>}
        {current ? (
          <NoteEditor key={keyOf(current)} scope={current.scope} noteId={current.id} onDeleted={() => select(null)} topLevel={current.scope.kind === "projects" && current.scope.id === homeId} />
        ) : (
          <EmptyNote />
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
        <Button size="sm" variant="outline" aria-label="New note" title="New note" disabled={!folders?.length}>
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
                {f.home && <span className="text-muted-foreground ml-auto text-[10px]">routed by the top chief</span>}
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
