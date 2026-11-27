import { MapLegend } from "@/components/onboarding/map-legend";
import { ResponsiveView } from "@/components/mobile/viewport";
import { ProjectList } from "@/components/mobile/project-list";
import { loadSidebarProjects } from "@/components/layout/sidebar-tree";
import { AddProjectForm } from "@/components/home/add-project-form";
import { SystemMap } from "@/components/space/system-map";
import { CivPanel } from "@/components/world/civ-panel";
import { VanillaProjects } from "@/components/vanilla/projects";
import { hasDatabase } from "@/lib/db/server";
import { getLook } from "@/lib/look.server";
import { getPlanetPositions } from "@/lib/world/positions.server";
import { listProjects } from "@/lib/db/repo/projects";

export const dynamic = "force-dynamic";

// Solar keeps its map; Vanilla lists projects with their live status.
export default async function Home() {
  const [projects, look, positions, sidebarProjects] = await Promise.all([listProjects().catch(() => []), getLook(), getPlanetPositions(), loadSidebarProjects()]);
  const mobile = <ProjectList projects={sidebarProjects} />;
  if (look === "vanilla") return <ResponsiveView mobile={mobile}><VanillaProjects projects={sidebarProjects} durable={hasDatabase()} /></ResponsiveView>;

  const overlay = (
    <>
      <MapLegend />
      {projects.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <CivPanel parchment className="pointer-events-auto w-full max-w-sm" bodyClassName="flex flex-col items-center px-6 py-6 text-center">
            <h2 className="pixel text-2xl world:text-2xl">Add your first project</h2>
            <p className="mt-2 mb-5 text-sm opacity-80">
              Every project becomes a planet on this map. Clone a repo, open a folder, or start something new.
            </p>
            <AddProjectForm />
          </CivPanel>
        </div>
      )}
      {!hasDatabase() && (
        <p className="pixel text-muted-foreground pointer-events-none absolute inset-x-0 top-20 z-10 px-6 text-center text-xs world:text-white/80 world:[text-shadow:1px_1px_0_#0008]">
          Thunk is running without a database: projects, tasks, routines and session history won&apos;t survive a server restart. Notes, vault files and memory remain on disk.
        </p>
      )}
    </>
  );

  return <ResponsiveView mobile={mobile}><SystemMap projects={projects} positions={positions}>{overlay}</SystemMap></ResponsiveView>;
}
