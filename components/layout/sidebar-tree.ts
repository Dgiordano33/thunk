import "server-only";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listAllWorkspaces } from "@/lib/supabase/repo/workspaces";

/** Every project with its active workspaces, for the sidebar, ⌘K search and settings. Two queries total. */
export async function loadSidebarProjects(): Promise<SidebarProject[]> {
  const [projects, workspaces] = await Promise.all([
    listProjects().catch(() => []),
    listAllWorkspaces().catch(() => []),
  ]);
  return projects.map((p) => ({
    ...p,
    // Stable order so rows don't jump as sessions touch updated_at: main first, then oldest to newest.
    workspaces: workspaces
      .filter((w) => w.projectId === p.id && w.status === "active")
      .sort((a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt)),
  }));
}
