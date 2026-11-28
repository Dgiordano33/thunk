"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { NoteMeta, NoteScope } from "@/lib/notes/types";
import type { Task } from "@/lib/tasks/types";
import type { VaultItem } from "@/lib/vault/types";

export type NoteOption = { ref: { scope: NoteScope; id: string }; title: string; group: string };

export const noteRefKey = (r: { scope: NoteScope; id: string }) => `${r.scope.kind}:${r.scope.id}:${r.id}`;

/** A project's notes (grouped by notebook), tasks and Vault items: what a session or routine can be given. Null while loading. */
export function useContextOptions(projectId: string, { vault = true } = {}) {
  const [notes, setNotes] = useState<NoteOption[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [vaultItems, setVaultItems] = useState<VaultItem[] | null>(vault ? null : []);

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
    if (vault) api.listVault(projectId).then(({ items }) => live && setVaultItems(items)).catch(() => live && setVaultItems([]));
    return () => { live = false; };
  }, [projectId, vault]);

  return { notes, tasks, vault: vaultItems, loading: notes === null || tasks === null || vaultItems === null };
}
