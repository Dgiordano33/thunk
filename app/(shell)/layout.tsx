import { AppSidebar } from "@/components/layout/app-sidebar";
import { ShellPanels } from "@/components/layout/shell-panels";
import { loadSidebarProjects } from "@/components/layout/sidebar-tree";

export const dynamic = "force-dynamic";

// Persistent chrome: projects with their workspaces nested on the left, the routed page on the right.
export default async function ShellLayout({ children }: LayoutProps<"/">) {
  const tree = await loadSidebarProjects();
  return <ShellPanels sidebar={<AppSidebar projects={tree} />}>{children}</ShellPanels>;
}
