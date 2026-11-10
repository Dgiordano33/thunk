"use client";

import { useState } from "react";
import { CheckIcon, FilterIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { noteFilters, savedNoteViewsSchema, type NoteFilter, type SavedNoteView } from "@/lib/notes/views";

const STORAGE_KEY = "thunk:notes:saved-views";

export function NoteFilters({ query, filter, onChange }: {
  query: string;
  filter: NoteFilter;
  onChange: (query: string, filter: NoteFilter) => void;
}) {
  const [views, setViews] = useState<SavedNoteView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const active = filter !== "all" || Boolean(query.trim());

  const load = (open: boolean) => {
    if (!open) return;
    setLoaded(false);
    try {
      setViews(savedNoteViewsSchema.parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")));
      setLoaded(true);
      setError(null);
    } catch {
      setError("Couldn't load saved views from this browser.");
    }
  };
  const persist = (next: SavedNoteView[]) => {
    if (!loaded) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedNoteViewsSchema.parse(next)));
      setViews(next);
      setError(null);
      return true;
    } catch {
      setError("Couldn't save views in this browser.");
      return false;
    }
  };

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant={active ? "secondary" : "outline"} aria-label="Filters and saved views" title="Filters and saved views">
          <FilterIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">Filter notes</h3>
          {active && <Button size="xs" variant="ghost" onClick={() => onChange("", "all")}>Clear</Button>}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Note filters">
          {Object.entries(noteFilters).map(([value, label]) => (
            <Button key={value} size="xs" variant={filter === value ? "secondary" : "outline"} aria-pressed={filter === value} onClick={() => onChange(query, value as NoteFilter)}>{label}</Button>
          ))}
        </div>
        <div className="border-t pt-3">
          <h3 className="mb-2 text-xs font-semibold">Saved views</h3>
          <p className="text-muted-foreground mb-2 text-xs">Save your search and filter in this browser.</p>
          {views.length === 0 && <p className="text-muted-foreground mb-2 text-xs">No saved views yet.</p>}
          <div className="max-h-48 overflow-y-auto">
            {views.map((view) => (
              <div key={view.name} className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => onChange(view.query, view.filter)}>
                  <span className="truncate">{view.name}</span>
                  {query === view.query && filter === view.filter && <CheckIcon className="ml-auto size-3" aria-label="Active view" />}
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Delete view ${view.name}`} onClick={() => persist(views.filter((v) => v.name !== view.name))}><Trash2Icon /></Button>
              </div>
            ))}
          </div>
          <form className="mt-2 flex gap-1" onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            if (views.some((view) => view.name.toLowerCase() === trimmed.toLowerCase())) {
              setError("A view with that name already exists.");
              return;
            }
            if (persist([...views, { name: trimmed, query, filter }])) setName("");
          }}>
            <Input className="h-7 min-w-0 text-xs" aria-label="Saved view name" placeholder="View name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={!loaded || !name.trim()}>Save</Button>
          </form>
          {error && <p role="alert" className="text-destructive mt-2 text-xs">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
