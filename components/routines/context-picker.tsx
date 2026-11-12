"use client";

import { NotebookTextIcon, PlusIcon, SquareCheckIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/client/api";
import type { NoteMeta } from "@/lib/notes/types";
import type { RoutineContext, RoutineNoteRef } from "@/lib/routines/types";
import { OPEN_TASK_STATUSES, TASK_STATUS_LABELS, type Task } from "@/lib/tasks/types";

type NoteOption = { ref: RoutineNoteRef; title: string; group: string };

const refKey = (r: RoutineNoteRef) => `${r.scope.kind}:${r.scope.id}:${r.id}`;

/** Attach notes and tasks a routine reads fresh at the start of every run. */
export function ContextPicker({ projectId, value, onChange }: { projectId: string; value: RoutineContext; onChange: (next: RoutineContext) => void }) {
  const [notes, setNotes] = useState<NoteOption[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const option = (group: string) => (n: NoteMeta): NoteOption => ({ ref: { scope: n.scope, id: n.id }, title: n.title || "Untitled", group });
    api.listAllNotes().then(({ projects }) => {
      const folder = projects.find((p) => p.project.id === projectId);
      if (!live) return;
      setNotes(folder ? [
        ...folder.notes.map(option("Project notes")),
        ...folder.repos.flatMap((r) => r.notes.map(option(r.notebook.label || r.notebook.repoName))),
        ...folder.workspaces.flatMap((w) => w.notes.map(option(`Workspace · ${w.workspace.name}`))),
      ] : []);
    }).catch(() => live && setNotes([]));
    api.listTasks({ projectId }).then(({ tasks }) => live && setTasks(tasks)).catch(() => live && setTasks([]));
    return () => { live = false; };
  }, [projectId]);

  const noteByKey = useMemo(() => new Map((notes ?? []).map((n) => [refKey(n.ref), n])), [notes]);
  const taskById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const attachedNotes = new Set(value.notes.map(refKey));
  const attachedTasks = new Set(value.taskIds);
  const grouped = new Map<string, NoteOption[]>();
  for (const n of notes ?? []) if (!attachedNotes.has(refKey(n.ref))) grouped.set(n.group, [...(grouped.get(n.group) ?? []), n]);
  const noteGroups = [...grouped];
  const openTasks = (tasks ?? []).filter((t) => !attachedTasks.has(t.id) && OPEN_TASK_STATUSES.includes(t.status));

  const removeNote = (ref: RoutineNoteRef) => onChange({ ...value, notes: value.notes.filter((r) => refKey(r) !== refKey(ref)) });
  const removeTask = (id: string) => onChange({ ...value, taskIds: value.taskIds.filter((t) => t !== id) });
  const empty = !value.notes.length && !value.taskIds.length;

  return (
    <div className="flex flex-col gap-2">
      {!empty && (
        <ul className="flex flex-col gap-1">
          {value.notes.map((ref) => {
            const n = noteByKey.get(refKey(ref));
            return (
              <Attached key={refKey(ref)} icon={<NotebookTextIcon />} label={n?.title ?? (notes ? "Missing note" : "Loading…")} detail={n?.group ?? ref.id} missing={Boolean(notes && !n)} onRemove={() => removeNote(ref)} />
            );
          })}
          {value.taskIds.map((id) => {
            const t = taskById.get(id);
            return (
              <Attached key={id} icon={<SquareCheckIcon />} label={t?.title ?? (tasks ? "Missing task" : "Loading…")} detail={t ? `Task · ${TASK_STATUS_LABELS[t.status]}` : id.slice(0, 8)} missing={Boolean(tasks && !t)} onRemove={() => removeTask(id)} />
            );
          })}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="text-muted-foreground hover:bg-muted focus-visible:ring-ring flex h-7 w-fit items-center gap-1 rounded-md border border-dashed px-2 text-[11px] outline-none focus-visible:ring-2 [&_svg]:size-3">
            <PlusIcon /> Attach a note or task
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search notes and open tasks…" />
            <CommandList className="max-h-72">
              <CommandEmpty>{notes === null || tasks === null ? "Loading…" : "Nothing left to attach."}</CommandEmpty>
              {noteGroups.map(([group, options]) => (
                <CommandGroup key={group} heading={group}>
                  {options.map((n) => (
                    <CommandItem key={refKey(n.ref)} value={`${refKey(n.ref)} ${n.title}`} onSelect={() => { onChange({ ...value, notes: [...value.notes, n.ref] }); setOpen(false); }}>
                      <NotebookTextIcon /> <span className="truncate">{n.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {openTasks.length > 0 && (
                <CommandGroup heading="Open tasks">
                  {openTasks.map((t) => (
                    <CommandItem key={t.id} value={`${t.id} ${t.title}`} onSelect={() => { onChange({ ...value, taskIds: [...value.taskIds, t.id] }); setOpen(false); }}>
                      <SquareCheckIcon /> <span className="truncate">{t.title}</span>
                      <span className="text-muted-foreground ml-auto text-[10px]">{TASK_STATUS_LABELS[t.status]}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Attached({ icon, label, detail, missing, onRemove }: { icon: React.ReactNode; label: string; detail: string; missing: boolean; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs [&>svg]:size-3.5 [&>svg]:shrink-0">
      {icon}
      <span className={missing ? "text-destructive truncate" : "truncate"}>{label}</span>
      <span className="text-muted-foreground ml-auto shrink-0 truncate text-[11px]">{detail}</span>
      <button type="button" aria-label={`Detach ${label}`} onClick={onRemove} className="text-muted-foreground hover:text-foreground rounded p-0.5 [&_svg]:size-3">
        <XIcon />
      </button>
    </li>
  );
}
