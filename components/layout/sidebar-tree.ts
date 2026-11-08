import "server-only";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

/** Every project with its active workspaces, for the sidebar, ⌘K search and settings. */
export async function loadSidebarProjects(): Promise<SidebarProject[]> {
  const projects = await listProjects().catch(() => []);
  return Promise.all(
    projects.map(async (p) => ({
      ...p,
      // Stable order so rows don't jump as sessions touch updated_at: main first, then oldest to newest.
      workspaces: (await listWorkspaces(p.id).catch(() => []))
        .filter((w) => w.status === "active")
        .sort((a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt)),
    })),
  );
}
