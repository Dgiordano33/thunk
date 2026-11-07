"use client";

import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { Workspace } from "@/lib/projects/types";

export function WorkspaceActions({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMain = workspace.slug === "main";

  const toggleArchive = async () => {
    setBusy("archive");
    setError(null);
    try {
      await api.updateWorkspace(workspace.id, { status: workspace.status === "archived" ? "active" : "archived" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const what = workspace.worktreePath
      ? `Delete workspace "${workspace.name}", its sessions, and remove the worktree at ${workspace.worktreePath}? Uncommitted work there is lost.`
      : `Delete workspace "${workspace.name}" and its sessions?`;
    if (!window.confirm(what)) return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteWorkspace(workspace.id, { worktree: true, memory: true });
      router.push(`/p/${workspace.projectId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" className="h-7" onClick={toggleArchive} disabled={busy !== null}>
        {busy === "archive" ? (
          <Loader2Icon className="animate-spin" />
        ) : workspace.status === "archived" ? (
          <ArchiveRestoreIcon />
        ) : (
          <ArchiveIcon />
        )}
        {workspace.status === "archived" ? "Unarchive" : "Archive"}
      </Button>
      {!isMain && (
        <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={remove} disabled={busy !== null}>
          {busy === "delete" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
          Delete
        </Button>
      )}
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
