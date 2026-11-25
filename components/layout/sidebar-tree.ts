import "server-only";
import { cache } from "react";
import { workerWorkspaceIds } from "@/lib/db/repo/sessions";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { listProjects } from "@/lib/db/repo/projects";
import { listAllWorkspaces } from "@/lib/db/repo/workspaces";
import { listCanvases } from "@/lib/board/service";
import type { CanvasSession } from "@/lib/board/types";

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

/** Each project's canvases by project id, for the sidebar's Canvas group. A project whose boards can't be read lists none. */
export async function loadSidebarCanvases(projects: SidebarProject[]): Promise<Record<string, CanvasSession[]>> {
  return Object.fromEntries(await Promise.all(projects.map(async (p) => [p.id, await listCanvases(p.dataKey).catch(() => [])] as const)));
}
