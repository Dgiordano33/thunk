"use client";

import { FolderIcon, GitBranchIcon } from "lucide-react";
import { PixelIcon } from "@/components/world/pixel-icon";
import { scopeKey, type NoteFolder, type NoteScope } from "@/lib/notes/types";
import { cn } from "@/lib/utils";

const count = (n: number) => <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">{n}</span>;

/** Left pane of the Library: "All notes", then each project with its workspaces nested. */
export function LibraryFolders({
  folders,
  selected,
  onSelect,
}: {
  folders: NoteFolder[] | null;
  /** null = All notes. */
  selected: NoteScope | null;
  onSelect: (scope: NoteScope | null) => void;
}) {
  const active = selected ? scopeKey(selected) : null;
  const total = folders?.reduce((n, f) => n + f.repos.reduce((m, r) => m + r.notes.length, 0) + f.notes.length + f.workspaces.reduce((m, w) => m + w.notes.length, 0), 0) ?? 0;
  const row = (on: boolean) =>
    cn(
      "focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2",
      on ? "bg-[color-mix(in_oklch,var(--w-bronze)_30%,transparent)] ring-1 ring-[var(--w-bronze)]" : "hover:bg-muted",
    );

  return (
    <nav aria-label="Notebooks" className="flex flex-col gap-0.5 overflow-y-auto p-2">
      <button type="button" className={row(active === null)} aria-current={active === null ? "true" : undefined} onClick={() => onSelect(null)}>
        <PixelIcon name="scroll" className="size-4 shrink-0" />
        <span className="font-medium">All notes</span>
        {count(total)}
      </button>
      {folders === null && [0, 1].map((i) => <div key={i} className="bg-muted/50 mx-2 my-1 h-6 animate-pulse rounded" />)}
      {folders?.map((f) => {
        const pScope: NoteScope = { kind: "projects", id: f.project.id };
        return (
          <div key={f.project.id} className="mt-2 flex flex-col gap-0.5">
            <button type="button" className={row(active === scopeKey(pScope))} onClick={() => onSelect(pScope)} aria-current={active === scopeKey(pScope) ? "true" : undefined}>
              <PixelIcon name="castle" className="size-4 shrink-0" />
              <span className="min-w-0 truncate font-medium">{f.project.name}</span>
              {count(f.notes.length)}
            </button>
            {f.workspaces.map(({ workspace, notes }) => {
              const wScope: NoteScope = { kind: "workspaces", id: workspace.id };
              const local = workspace.slug === "main";
              const Icon = local ? FolderIcon : GitBranchIcon;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className={cn(row(active === scopeKey(wScope)), "pl-7")}
                  onClick={() => onSelect(wScope)}
                  aria-current={active === scopeKey(wScope) ? "true" : undefined}
                >
                  <Icon className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{local ? "Local" : workspace.name}</span>
                  {count(notes.length)}
                </button>
              );
            })}
            {f.repos.map(({ notebook, notes }) => {
              const scope: NoteScope = { kind: "repos", id: notebook.id };
              return <button key={notebook.id} type="button" className={cn(row(active === scopeKey(scope)), "pl-7")} onClick={() => onSelect(scope)} aria-current={active === scopeKey(scope) ? "true" : undefined}>
                <span className="min-w-0 truncate">{notebook.repoId ? `${notebook.repoName} / ` : ""}{notebook.path}</span>
                <span className="text-muted-foreground text-[10px]">repo</span>{count(notes.length)}
              </button>;
            })}
          </div>
        );
      })}
      {folders?.length === 0 && <p className="text-muted-foreground px-2 py-2 text-xs">Add a project to start a notebook.</p>}
    </nav>
  );
}
