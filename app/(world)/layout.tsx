import { loadSidebarProjects } from "@/components/layout/sidebar-tree";
import { PathsProvider } from "@/components/layout/paths-context";
import { pathTree } from "@/components/layout/sidebar-tree-paths";
import { WorldHud } from "@/components/world/world-hud";
import { projectNoteDirs, workspaceNoteDirs } from "@/lib/notes/resolve";
import { countNotes } from "@/lib/notes/store";
import { countEnabledRoutines } from "@/lib/supabase/repo/routines";
import { countOpen } from "@/lib/supabase/repo/notifications";
import { countVaultItems } from "@/lib/vault/service";

export const dynamic = "force-dynamic";

// Full-bleed home: the world map (or a placeholder section) under the strategy-game HUD. No project sidebar.
export default async function WorldLayout({ children }: LayoutProps<"/">) {
  const projects = await loadSidebarProjects();
  const noteCount = await countNotes(
    projects.flatMap((p) => [projectNoteDirs(p), ...p.workspaces.map((w) => workspaceNoteDirs(p, w))]),
  ).catch(() => 0);
  const routineCount = await countEnabledRoutines().catch(() => 0);
  const notificationCount = await countOpen().then((c) => c.action).catch(() => 0);
  const vaultCount = await countVaultItems(projects).catch(() => 0);
  return (
    <PathsProvider projects={pathTree(projects)}>
      <div className="world relative h-dvh overflow-hidden">
        {children}
        <WorldHud projects={projects} noteCount={noteCount} routineCount={routineCount} vaultCount={vaultCount} notificationCount={notificationCount} />
      </div>
    </PathsProvider>
  );
}
