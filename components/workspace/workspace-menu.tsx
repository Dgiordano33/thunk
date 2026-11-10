"use client";

import { useState } from "react";
import { HarvestDialog, type HarvestAction } from "./harvest-dialog";
import type { HarvestData } from "@/lib/projects/harvest";
import { ArchiveIcon, ArchiveRestoreIcon, EllipsisIcon, GitMergeIcon, NotebookPenIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import type { Workspace } from "@/lib/projects/types";
import { projectPath, workspacePath } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** New note / save to project / archive / delete for a workspace. */
export function WorkspaceMenu({ project, workspace, label, className }: { project: { slug: string }; workspace: Workspace; label: string; className?: string }) {
  const router = useRouter();
  const [harvest, setHarvest] = useState<{ data: HarvestData; action: HarvestAction } | null>(null);
  const pathname = usePathname();
  const base = workspacePath(project, workspace);
  const viewing = pathname === base || pathname.startsWith(`${base}/`);
  const isMain = workspace.slug === "main";
  const archived = workspace.status === "archived";

  // Leaving the sidebar: step out to the project if we're looking at it.
  const done = () => {
    if (viewing) router.push(projectPath(project));
    router.refresh();
  };

  const toggleArchive = async () => {
    try {
      await api.updateWorkspace(workspace.id, { status: archived ? "active" : "archived" });
      if (!archived) router.push(`${projectPath(project)}?harvest=${workspace.id}`);
      else done();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  const openHarvest = async (action: HarvestAction) => {
    try {
      const data = await api.getHarvest(workspace.id);
      if (data.empty && action !== "harvest") {
        const what = action === "merge" ? "Merge committed changes into the local default branch, run the archive hook, and delete" : "Delete";
        if (!window.confirm(`${what} "${label}" and its sessions? Memory and notes go to the granary. ${workspace.branch ? "Worktree deletion requires committed changes merged into the default branch." : `Shared folders and non-empty scratch folders are kept at ${workspace.cwd}.`}`)) return;
        if (action === "merge") await api.workspaceGitAction(workspace.id, "merge", true);
        else {
          const result = await api.deleteWorkspace(workspace.id, { worktree: true });
          if (result.retainedDirectory) window.alert(`Files kept in ${result.retainedDirectory}`);
        }
        done();
      } else setHarvest({ data, action });
    } catch (err) { window.alert((err as Error).message); }
  };

  const newNote = async () => {
    try {
      const { note } = await api.createNote("workspaces", workspace.id, { title: "Untitled" });
      router.push(`/notes?scope=w:${workspace.id}&note=${note.id}`);
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`${label} options`} className={cn(className)}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={newNote}>
          <NotebookPenIcon /> New note
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openHarvest("harvest")} title="Copy this workspace's memory and notes into the project">
          <SaveIcon /> Save to project…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleArchive}>
          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
        {!isMain && (
          <>
            <DropdownMenuSeparator />
            {workspace.branch && <DropdownMenuItem onSelect={() => openHarvest("merge")}>
              <GitMergeIcon /> Merge and delete…
            </DropdownMenuItem>}
            <DropdownMenuItem variant="destructive" onSelect={() => openHarvest("delete")}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

    {harvest && <HarvestDialog hasGit={!!workspace.branch} workspaceId={workspace.id} label={label} {...harvest} onClose={() => setHarvest(null)} onComplete={done} />}
    </>
  );
}
