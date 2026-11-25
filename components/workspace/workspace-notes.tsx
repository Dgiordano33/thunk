"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useNoteActions } from "@/components/notes/library";
import { NoteEditor } from "@/components/notes/note-editor";
import { NoteList } from "@/components/notes/note-list";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { NoteScope } from "@/lib/notes/types";
import { useScopeNotes } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";

/** The workspace Notes tab: project notes first, with optional workspace notes. Notes open in a wide sheet. */
export function WorkspaceNotes({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const wScope: NoteScope = { kind: "workspaces", id: workspaceId };
  const pScope: NoteScope = { kind: "projects", id: projectId };
  const [open, setOpen] = useState<{ scope: NoteScope; id: string } | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const ws = useScopeNotes(workspaceOpen ? wScope : null);
  const project = useScopeNotes(pScope);
  const wsActions = useNoteActions(wScope, (id) => setOpen(id ? { scope: wScope, id } : null));
  const pActions = useNoteActions(pScope, (id) => setOpen(id ? { scope: pScope, id } : null));

  return (
    <div className="flex flex-col pb-4">
      <NoteList
        notes={project.notes}
        selectedId={open?.scope.kind === "projects" ? open.id : null}
        onSelect={(id) => setOpen({ scope: pScope, id })}
        onCreate={() => void pActions.create()}
        onDelete={(n) => void pActions.remove(n)}
      />

      <section className="border-t">
        <button
          type="button"
          aria-expanded={workspaceOpen}
          onClick={() => setWorkspaceOpen((o) => !o)}
          className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium"
        >
          <ChevronRightIcon className={cn("text-muted-foreground size-3.5 transition-transform", workspaceOpen && "rotate-90")} />
          Workspace notes
          {ws.notes && <span className="text-muted-foreground tabular-nums">{ws.notes.length}</span>}
        </button>
        {workspaceOpen && (
          <NoteList
            notes={ws.notes}
            selectedId={open?.scope.kind === "workspaces" ? open.id : null}
            onSelect={(id) => setOpen({ scope: wScope, id })}
            onCreate={() => void wsActions.create()}
            onDelete={(n) => void wsActions.remove(n)}
          />
        )}
      </section>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full md:w-[min(760px,92vw)] data-[side=right]:w-full gap-0 p-0 data-[side=right]:sm:max-w-none">
          <SheetTitle className="sr-only">Note</SheetTitle>
          <SheetDescription className="sr-only">Edit the note. Changes save automatically.</SheetDescription>
          <div className="flex h-full min-h-0 flex-col pt-10">
            {open && <NoteEditor key={`${open.scope.kind}/${open.id}`} scope={open.scope} noteId={open.id} onDeleted={() => setOpen(null)} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
