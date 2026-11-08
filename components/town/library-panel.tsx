"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RepoNotebooks } from "@/components/project/repo-notebooks";
import { ScopeNotes } from "@/components/notes/library";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { scopeKey, type NoteScope } from "@/lib/notes/types";
import { TownPanel } from "./town-panel";

/** The town Library: the project's notebook, with a switcher to any of its workspaces' notebooks. */
export function LibraryPanel({
  projectId,
  workspaces,
  closeHref,
}: {
  projectId: string;
  workspaces: { id: string; label: string }[];
  closeHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ws = params.get("nws");
  const scope: NoteScope = ws && workspaces.some((w) => w.id === ws) ? { kind: "workspaces", id: ws } : { kind: "projects", id: projectId };
  const note = params.get("note");

  const go = (next: { ws?: string | null; note?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    q.set("building", "library");
    const nws = next.ws === undefined ? ws : next.ws;
    const nnote = next.note === undefined ? note : next.note;
    if (nws) q.set("nws", nws);
    else q.delete("nws");
    if (nnote) q.set("note", nnote);
    else q.delete("note");
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  return (
    <TownPanel
      eyebrow="Library"
      title="Notes"
      closeHref={closeHref}
      wide
      actions={
        <Link href={`/notes?scope=${scopeKey(scope)}${note ? `&note=${note}` : ""}`} className="pixel hover:bg-muted px-2 py-1 text-xs whitespace-nowrap">
          Open in Library →
        </Link>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <RepoNotebooks projectId={projectId} />
        <ScopeNotes
          key={scopeKey(scope)}
          scope={scope}
          selectedId={note}
          onSelect={(id) => go({ note: id })}
          listHeader={
            <div className="border-b p-2">
              <Select value={scope.kind === "projects" ? "project" : scope.id} onValueChange={(v) => go({ ws: v === "project" ? null : v, note: null })}>
                <SelectTrigger size="sm" className="w-full text-xs" aria-label="Notebook">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project notes</SelectItem>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>Workspace · {w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      </div>
    </TownPanel>
  );
}
