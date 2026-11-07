import { AppSidebar, type SidebarProject } from "@/components/layout/app-sidebar";
import { ShellPanels } from "@/components/layout/shell-panels";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

// Persistent chrome: projects with their workspaces nested on the left, the routed page on the right.
export default async function ShellLayout({ children }: LayoutProps<"/">) {
  const projects = await listProjects().catch(() => []);
  const tree: SidebarProject[] = await Promise.all(
    projects.map(async (p) => ({
      ...p,
      // Stable order so rows don't jump as sessions touch updated_at: main first, then oldest to newest.
      workspaces: (await listWorkspaces(p.id).catch(() => []))
        .filter((w) => w.status === "active")
        .sort((a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt)),
    })),
  );

  return <ShellPanels sidebar={<AppSidebar projects={tree} />}>{children}</ShellPanels>;
}
