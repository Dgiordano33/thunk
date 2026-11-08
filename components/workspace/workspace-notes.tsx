"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useNoteActions } from "@/components/notes/library";
import { NoteEditor } from "@/components/notes/note-editor";
import { NoteList } from "@/components/notes/note-list";
import { NoteTasks } from "@/components/notes/note-tasks";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { NoteScope } from "@/lib/notes/types";
import { useScopeNotes } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";

/** The workspace Notes tab: workspace notes, project notes, and open tasks. Notes open in a wide sheet. */
export function WorkspaceNotes({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const wScope: NoteScope = { kind: "workspaces", id: workspaceId };
  const pScope: NoteScope = { kind: "projects", id: projectId };
  const [open, setOpen] = useState<{ scope: NoteScope; id: string } | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const ws = useScopeNotes(wScope);
  const project = useScopeNotes(projectOpen ? pScope : null);
  const wsActions = useNoteActions(wScope, (id) => setOpen(id ? { scope: wScope, id } : null));
  const pActions = useNoteActions(pScope, (id) => setOpen(id ? { scope: pScope, id } : null));

  return (
    <div className="flex flex-col pb-4">
      <NoteList
        notes={ws.notes}
        selectedId={open?.scope.kind === "workspaces" ? open.id : null}
        onSelect={(id) => setOpen({ scope: wScope, id })}
        onCreate={() => void wsActions.create()}
        onDelete={(n) => void wsActions.remove(n)}
      />

      <section className="border-t">
        <button
          type="button"
          aria-expanded={projectOpen}
          onClick={() => setProjectOpen((o) => !o)}
          className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium"
        >
          <ChevronRightIcon className={cn("text-muted-foreground size-3.5 transition-transform", projectOpen && "rotate-90")} />
          Project notes
          {project.notes && <span className="text-muted-foreground tabular-nums">{project.notes.length}</span>}
        </button>
        {projectOpen && (
          <NoteList
            notes={project.notes}
            selectedId={open?.scope.kind === "projects" ? open.id : null}
            onSelect={(id) => setOpen({ scope: pScope, id })}
            onCreate={() => void pActions.create()}
            onDelete={(n) => void pActions.remove(n)}
          />
        )}
      </section>

      <section className="border-t px-3 pt-3">
        <h3 className="mb-2 text-xs font-medium">Tasks</h3>
        <NoteTasks scopes={[wScope, pScope]} workspaceId={workspaceId} />
      </section>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-[min(760px,92vw)] gap-0 p-0 data-[side=right]:sm:max-w-none">
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
