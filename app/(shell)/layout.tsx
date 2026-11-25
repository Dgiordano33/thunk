import { cookies } from "next/headers";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ShellPanels } from "@/components/layout/shell-panels";
import { loadSidebarCanvases, loadSidebarProjects } from "@/components/layout/sidebar-tree";
import { PathsProvider } from "@/components/layout/paths-context";
import { pathTree } from "@/components/layout/sidebar-tree-paths";
import { PanelLayoutCookies } from "@/components/ui/resizable";
import { panelCookies } from "@/lib/panel-layout";

export const dynamic = "force-dynamic";

// Persistent chrome: projects with their workspaces nested on the left, the routed page on the right.
export default async function ShellLayout({ children }: LayoutProps<"/">) {
  const [tree, jar] = await Promise.all([loadSidebarProjects(), cookies()]);
  const canvases = await loadSidebarCanvases(tree);
  // Saved panel sizes come from cookies, so this render matches the browser's.
  return (
    <PanelLayoutCookies value={panelCookies(jar.getAll())}>
      <PathsProvider projects={pathTree(tree)}>
        <ShellPanels sidebar={<AppSidebar projects={tree} canvases={canvases} />}>{children}</ShellPanels>
      </PathsProvider>
    </PanelLayoutCookies>
  );
}
