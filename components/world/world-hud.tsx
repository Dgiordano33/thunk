"use client";

import { useIsDesktop } from "@/components/mobile/viewport";
import { MobileTopBar } from "@/components/mobile/top-bar";
import { usePathname } from "next/navigation";
import { AmbientHub } from "@/components/ambient/ambient-hub";
import { AddProjectForm } from "@/components/home/add-project-form";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { projectSlugFromPath, isProjectPath, PROJECTS_PATH } from "@/lib/routes";
import { CivPanel } from "./civ-panel";
import { CivToolbar } from "./civ-toolbar";
import { HudTitle } from "./hud-title";

/** Chrome over the world map: title, actions, and the bottom-left command menu. */
export function WorldHud({ projects, noteCount, routineCount, vaultCount, notificationCount }: { projects: SidebarProject[]; noteCount: number; routineCount: number; vaultCount: number; notificationCount: number }) {
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const home = pathname === PROJECTS_PATH;
  const project = isProjectPath(pathname) ? projects.find((p) => p.slug === projectSlugFromPath(pathname)) : undefined;
  return (
    <>
      {!desktop ? <MobileTopBar title={project?.name ?? (home ? "Projects" : pathname.split("/").filter(Boolean).at(-1) ?? "Thunk")} actions={<AmbientHub projects={projects} variant="hud" />} /> : <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-3 px-3 py-2">
          <HudTitle projects={projects} noteCount={noteCount} />
        </CivPanel>
        <div className="pointer-events-auto flex items-center gap-2">
          <CivPanel bodyClassName="flex items-center p-1">
            <AmbientHub projects={projects} variant="hud" />
          </CivPanel>
          {home && <AddProjectForm />}
          {project && <NewWorkspaceButton hud projectId={project.id} projectSlug={project.slug} projectName={project.name} repos={project.repos} />}
        </div>
      </div>}
      <CivToolbar projects={projects} cityCount={projects.length} noteCount={noteCount} routineCount={routineCount} vaultCount={vaultCount} notificationCount={notificationCount} />
    </>
  );
}
