"use client";

import { ArchiveIcon, NotebookTextIcon, PlusIcon, SquareCheckIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { noteRefKey, useContextOptions, type NoteOption } from "@/components/context/use-context-options";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/client/api";
import { isEmptySelection, type ContextNoteRef, type ContextSelection, type ContextSet } from "@/lib/context/types";
import type { RoutineContext } from "@/lib/routines/types";
import { OPEN_TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/tasks/types";

const OWN = "own";

/** The saved context sets of a project, with a reload. Null while loading. */
export function useContextSets(projectId: string) {
  const [sets, setSets] = useState<ContextSet[] | null>(null);
  const reload = useCallback(() => api.listContextSets(projectId).then((r) => setSets(r.sets)).catch(() => setSets([])), [projectId]);
  useEffect(() => { void reload(); }, [reload]);
  return { sets, reload };
}

/**
 * Notes, tasks and Vault items a routine reads fresh at the start of every run: its own list, or a
 * saved context set. Its own list can be saved as a new set.
 */
export function ContextPicker({ projectId, value, onChange }: { projectId: string; value: RoutineContext; onChange: (next: RoutineContext) => void }) {
  const options = useContextOptions(projectId);
  const { sets, reload } = useContextSets(projectId);
  const set = value.setId ? sets?.find((s) => s.id === value.setId) : undefined;

  const choose = (id: string) => onChange({ ...value, setId: id === OWN ? null : id });
  const removeSet = async (s: ContextSet) => {
    if (!(await confirm({ title: `Delete the context set “${s.name}”?`, description: "Routines that use it go back to their own lists.", action: "Delete", destructive: true }))) return;
    try {
      await api.deleteContextSet(s.id);
      onChange({ ...value, setId: null });
      void reload();
    } catch (err) {
      toast.error("Couldn't delete the set", { description: (err as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {(sets?.length ?? 0) > 0 && (
        <Select value={value.setId ?? OWN} onValueChange={choose}>
          <SelectTrigger size="sm" className="w-fit min-w-48 text-xs" aria-label="Context source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OWN}>Its own list</SelectItem>
            {sets!.map((s) => <SelectItem key={s.id} value={s.id}>Set · {s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {value.setId ? (
        set ? (
          <>
            <SelectionList options={options} value={set} />
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground flex-1 text-[11px]">Edits to the set reach every routine and session that uses it.</p>
              <Button size="xs" variant="ghost" type="button" onClick={() => void removeSet(set)}>Delete set</Button>
            </div>
          </>
        ) : <p className="text-muted-foreground text-xs">{sets ? "This context set no longer exists. Pick another or go back to its own list." : "Loading…"}</p>
      ) : (
        <>
          <SelectionPicker options={options} value={value} onChange={(next) => onChange({ ...value, ...next })} />
          {!isEmptySelection(value) && <SaveAsSet projectId={projectId} value={value} onSaved={(s) => { void reload(); onChange({ ...value, setId: s.id }); }} />}
        </>
      )}
    </div>
  );
}

type Options = ReturnType<typeof useContextOptions>;

/** Pick notes, open tasks and Vault items into a selection. */
export function SelectionPicker({ options, value, onChange }: { options: Options; value: ContextSelection; onChange: (next: ContextSelection) => void }) {
  const { notes, tasks, vault, loading } = options;
  const [open, setOpen] = useState(false);
  const picked = new Set(value.notes.map(noteRefKey));
  const pickedTasks = new Set(value.taskIds);
  const pickedVault = new Set(value.vaultIds ?? []);
  const grouped = new Map<string, NoteOption[]>();
  for (const n of notes ?? []) if (!picked.has(noteRefKey(n.ref))) grouped.set(n.group, [...(grouped.get(n.group) ?? []), n]);
  const openTasks = (tasks ?? []).filter((t) => !pickedTasks.has(t.id) && OPEN_TASK_STATUSES.includes(t.status));
  const vaultLeft = (vault ?? []).filter((v) => !pickedVault.has(v.id));
  const add = (next: Partial<ContextSelection>) => { onChange({ ...value, ...next }); setOpen(false); };

  return (
    <div className="flex flex-col gap-2">
      <SelectionList options={options} value={value} onChange={onChange} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="text-muted-foreground hover:bg-muted focus-visible:ring-ring flex h-7 w-fit items-center gap-1 rounded-md border border-dashed px-2 text-[11px] outline-none focus-visible:ring-2 [&_svg]:size-3">
            <PlusIcon /> Attach a note, task or Vault item
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search notes, open tasks and the Vault…" />
            <CommandList className="max-h-72">
              <CommandEmpty>{loading ? "Loading…" : "Nothing left to attach."}</CommandEmpty>
              {[...grouped].map(([group, list]) => (
                <CommandGroup key={group} heading={group}>
                  {list.map((n) => (
                    <CommandItem key={noteRefKey(n.ref)} value={`${noteRefKey(n.ref)} ${n.title}`} onSelect={() => add({ notes: [...value.notes, n.ref] })}>
                      <NotebookTextIcon /> <span className="truncate">{n.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {openTasks.length > 0 && (
                <CommandGroup heading="Open tasks">
                  {openTasks.map((t) => (
                    <CommandItem key={t.id} value={`${t.id} ${t.title}`} onSelect={() => add({ taskIds: [...value.taskIds, t.id] })}>
                      <SquareCheckIcon /> <span className="truncate">{t.title}</span>
                      <span className="text-muted-foreground ml-auto text-[10px]">{TASK_STATUS_LABELS[t.status]}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {vaultLeft.length > 0 && (
                <CommandGroup heading="Vault">
                  {vaultLeft.map((v) => (
                    <CommandItem key={v.id} value={`${v.id} ${v.title}`} onSelect={() => add({ vaultIds: [...(value.vaultIds ?? []), v.id] })}>
                      <ArchiveIcon /> <span className="truncate">{v.title}</span>
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

/** The picked items; read-only without `onChange` (a saved set shown in a routine). */
function SelectionList({ options, value, onChange }: { options: Options; value: ContextSelection; onChange?: (next: ContextSelection) => void }) {
  const { notes, tasks, vault } = options;
  const noteByKey = useMemo(() => new Map((notes ?? []).map((n) => [noteRefKey(n.ref), n])), [notes]);
  const taskById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const vaultById = useMemo(() => new Map((vault ?? []).map((v) => [v.id, v])), [vault]);
  if (isEmptySelection(value)) return onChange ? null : <p className="text-muted-foreground text-xs">This set is empty.</p>;
  const removeNote = (ref: ContextNoteRef) => onChange?.({ ...value, notes: value.notes.filter((r) => noteRefKey(r) !== noteRefKey(ref)) });
  return (
    <ul className="flex flex-col gap-1">
      {value.notes.map((ref) => {
        const n = noteByKey.get(noteRefKey(ref));
        return <Attached key={noteRefKey(ref)} icon={<NotebookTextIcon />} label={n?.title ?? (notes ? "Missing note" : "Loading…")} detail={n?.group ?? ref.id} missing={Boolean(notes && !n)} onRemove={onChange && (() => removeNote(ref))} />;
      })}
      {value.taskIds.map((id) => {
        const t = taskById.get(id);
        return <Attached key={id} icon={<SquareCheckIcon />} label={t?.title ?? (tasks ? "Missing task" : "Loading…")} detail={t ? `Task · ${TASK_STATUS_LABELS[t.status]}` : id.slice(0, 8)} missing={Boolean(tasks && !t)} onRemove={onChange && (() => onChange({ ...value, taskIds: value.taskIds.filter((x) => x !== id) }))} />;
      })}
      {(value.vaultIds ?? []).map((id) => {
        const v = vaultById.get(id);
        return <Attached key={id} icon={<ArchiveIcon />} label={v?.title ?? (vault ? "Missing Vault item" : "Loading…")} detail="Vault" missing={Boolean(vault && !v)} onRemove={onChange && (() => onChange({ ...value, vaultIds: (value.vaultIds ?? []).filter((x) => x !== id) }))} />;
      })}
    </ul>
  );
}

/** Save the current list as a named set, then point at it. */
function SaveAsSet({ projectId, value, onSaved }: { projectId: string; value: ContextSelection; onSaved: (set: ContextSet) => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  if (!naming) return <Button size="xs" variant="ghost" type="button" className="w-fit" onClick={() => setNaming(true)}>Save as a context set</Button>;
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { set } = await api.createContextSet(projectId, { name: name.trim(), notes: value.notes, taskIds: value.taskIds, vaultIds: value.vaultIds ?? [] });
      toast.success(`Saved the context set “${set.name}”`);
      setNaming(false);
      setName("");
      onSaved(set);
    } catch (err) {
      toast.error("Couldn't save the set", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input autoFocus value={name} maxLength={80} placeholder="Set name" aria-label="Context set name" className="h-7 max-w-56 text-xs"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void save(); }
          if (e.key === "Escape") { e.stopPropagation(); setNaming(false); }
        }} />
      <Button size="xs" type="button" disabled={saving || !name.trim()} onClick={() => void save()}>Save</Button>
      <Button size="xs" variant="ghost" type="button" onClick={() => setNaming(false)}>Cancel</Button>
    </div>
  );
}

function Attached({ icon, label, detail, missing, onRemove }: { icon: React.ReactNode; label: string; detail: string; missing: boolean; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs [&>svg]:size-3.5 [&>svg]:shrink-0">
      {icon}
      <span className={missing ? "text-destructive truncate" : "truncate"}>{label}</span>
      <span className="text-muted-foreground ml-auto shrink-0 truncate text-[11px]">{detail}</span>
      {onRemove && (
        <button type="button" aria-label={`Detach ${label}`} onClick={onRemove} className="text-muted-foreground hover:text-foreground rounded p-0.5 [&_svg]:size-3">
          <XIcon />
        </button>
      )}
    </li>
  );
}
