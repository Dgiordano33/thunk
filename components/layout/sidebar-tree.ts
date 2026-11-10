import "server-only";
import { cache } from "react";
import { workerWorkspaceIds } from "@/lib/supabase/repo/sessions";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listAllWorkspaces } from "@/lib/supabase/repo/workspaces";

/** Every project with its active workspaces, for the sidebar, ⌘K search and settings. Includes persisted worker ownership. */
export const loadSidebarProjects = cache(async (): Promise<SidebarProject[]> => {
  const [projects, workspaces, workers] = await Promise.all([
    listProjects().catch(() => []),
    listAllWorkspaces().catch(() => []),
    workerWorkspaceIds().catch(() => new Set<string>()),
  ]);
  return projects.map((p) => ({
    ...p,
    // Stable order so rows don't jump as sessions touch updated_at: main first, then oldest to newest.
    workspaces: workspaces
      .filter((w) => w.projectId === p.id && w.status === "active")
      .map((w) => ({ ...w, worker: workers.has(w.id) }))
      .sort((a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt)),
  }));
});
