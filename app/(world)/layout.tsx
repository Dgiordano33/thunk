import { loadSidebarProjects } from "@/components/layout/sidebar-tree";
import { WorldHud } from "@/components/world/world-hud";

export const dynamic = "force-dynamic";

// Full-bleed home: the world map (or a placeholder section) under the strategy-game HUD. No project sidebar.
export default async function WorldLayout({ children }: LayoutProps<"/">) {
  const projects = await loadSidebarProjects();
  return (
    <div className="world relative h-dvh overflow-hidden">
      {children}
      <WorldHud projects={projects} />
    </div>
  );
}
