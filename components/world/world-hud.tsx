"use client";

import { usePathname } from "next/navigation";
import { AmbientHub } from "@/components/ambient/ambient-hub";
import { AddProjectForm } from "@/components/home/add-project-form";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import { isProjectPath, PROJECTS_PATH } from "@/lib/routes";
import { CivPanel } from "./civ-panel";
import { CivToolbar } from "./civ-toolbar";
import { HudTitle } from "./hud-title";

/** Chrome over the world map: title, actions, and the bottom-left command menu. */
export function WorldHud({ projects, noteCount, routineCount, vaultCount, notificationCount }: { projects: SidebarProject[]; noteCount: number; routineCount: number; vaultCount: number; notificationCount: number }) {
  const pathname = usePathname();
  const home = pathname === PROJECTS_PATH;
  const project = isProjectPath(pathname) ? projects.find((p) => p.slug === pathname.split("/")[1]) : undefined;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-3 px-3 py-2">
          <HudTitle projects={projects} noteCount={noteCount} />
        </CivPanel>
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-1 p-1">
          <AmbientHub projects={projects} variant="hud" />
          {home && <AddProjectForm />}
          {project && <NewWorkspaceButton hud projectId={project.id} projectSlug={project.slug} projectName={project.name} repos={project.repos} />}
        </CivPanel>
      </div>
      <CivToolbar projects={projects} cityCount={projects.length} noteCount={noteCount} routineCount={routineCount} vaultCount={vaultCount} notificationCount={notificationCount} />
    </>
  );
}
