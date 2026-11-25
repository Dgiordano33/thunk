"use client";

import { useEffect, useState } from "react";
import { LinkIcon } from "lucide-react";
import { api } from "@/lib/client/api";
import type { NoteMeta } from "@/lib/notes/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Workspace links organize project notes; removing a link never deletes the note. */
export function WorkspaceLinks({ note, onChange, disabled }: { note: NoteMeta; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.listWorkspaces(note.scope.id).then(({ workspaces }) => {
      if (!cancelled) setOptions(workspaces.map((w) => ({ id: w.id, name: w.status === "archived" ? `${w.name} (archived)` : w.name })));
    }, () => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [note.scope.id]);
  const linked = note.workspaceIds ?? [];
  const choices = [...options, ...linked.filter((id) => !options.some((w) => w.id === id)).map((id) => ({ id, name: "Closed workspace" }))];
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="xs" disabled={disabled} aria-label="Link note to workspaces"><LinkIcon />{linked.length ? `${linked.length} workspace${linked.length === 1 ? "" : "s"}` : "Link workspace"}</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuLabel>Project note · optional workspace links</DropdownMenuLabel>
      {choices.map((w) => <DropdownMenuCheckboxItem key={w.id} checked={linked.includes(w.id)} onCheckedChange={(checked) => onChange(checked ? [...linked, w.id] : linked.filter((id) => id !== w.id))}>{w.name}</DropdownMenuCheckboxItem>)}
      {!choices.length && <p className="text-muted-foreground max-w-64 px-2 py-1 text-xs">{error ? "Couldn't load workspaces. Reopen the note to retry." : "No workspaces available."}</p>}
      <p className="text-muted-foreground max-w-64 px-2 py-1 text-xs">Notes stay in the project when linked workspaces close.</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}
