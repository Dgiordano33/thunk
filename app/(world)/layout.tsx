import { cookies } from "next/headers";
import { getLook } from "@/lib/look.server";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ShellPanels } from "@/components/layout/shell-panels";
import { ResponsiveView } from "@/components/mobile/viewport";
import { HudTitle } from "@/components/world/hud-title";
import { PanelLayoutCookies } from "@/components/ui/resizable";
import { panelCookies } from "@/lib/panel-layout";
import { loadSidebarCanvases, loadSidebarProjects } from "@/components/layout/sidebar-tree";
import { PathsProvider } from "@/components/layout/paths-context";
import { pathTree } from "@/components/layout/sidebar-tree-paths";
import { WorldHud } from "@/components/world/world-hud";
import { projectNoteDirs, workspaceNoteDirs } from "@/lib/notes/resolve";
import { countNotes } from "@/lib/notes/store";
import { countEnabledRoutines } from "@/lib/db/repo/routines";
import { countOpen } from "@/lib/db/repo/notifications";
import { countVaultItems } from "@/lib/vault/service";

export const dynamic = "force-dynamic";

// Solar uses a full-bleed map; Vanilla shares the workspace sidebar on every desktop route.
export default async function WorldLayout({ children }: LayoutProps<"/">) {
  const projects = await loadSidebarProjects();
  const [noteCount, routineCount, notificationCount, vaultCount] = await Promise.all([
    countNotes(
      projects.flatMap((p) => [projectNoteDirs(p), ...p.workspaces.map((w) => workspaceNoteDirs(p, w))]),
    ).catch(() => 0),
    countEnabledRoutines().catch(() => 0),
    countOpen().then((c) => c.action).catch(() => 0),
    countVaultItems(projects).catch(() => 0),
  ]);
  const mapLayout = (
      <div className="world relative h-dvh overflow-hidden">
        {children}
        <WorldHud projects={projects} noteCount={noteCount} routineCount={routineCount} vaultCount={vaultCount} notificationCount={notificationCount} />
      </div>
  );
  if (await getLook() !== "vanilla") return <PathsProvider projects={pathTree(projects)}>{mapLayout}</PathsProvider>;
  const [canvases, jar] = await Promise.all([loadSidebarCanvases(projects), cookies()]);
  return <PanelLayoutCookies value={panelCookies(jar.getAll())}>
    <PathsProvider projects={pathTree(projects)}>
      <ResponsiveView mobile={mapLayout}>
        <ShellPanels sidebar={<AppSidebar projects={projects} canvases={canvases} />}>
          <div className="flex h-full min-h-0 flex-col bg-background">
            <header className="flex h-12 shrink-0 items-center border-b px-6"><HudTitle projects={projects} noteCount={noteCount} heading={false} /></header>
            <div className="vanilla-content relative min-h-0 flex-1 overflow-auto">{children}</div>
          </div>
        </ShellPanels>
      </ResponsiveView>
    </PathsProvider>
  </PanelLayoutCookies>;
}
