"use client";

import { usePathname } from "next/navigation";
import { AmbientHub } from "@/components/ambient/ambient-hub";
import { SettingsMenu } from "@/components/ambient/settings-menu";
import { AddProjectForm } from "@/components/home/add-project-form";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { CivPanel } from "./civ-panel";
import { CivToolbar } from "./civ-toolbar";
import { HudTitle } from "./hud-title";

/** Chrome over the world map: title, actions, and the bottom-left command menu. */
export function WorldHud({ projects, noteCount, routineCount }: { projects: SidebarProject[]; noteCount: number; routineCount: number }) {
  const home = usePathname() === "/";
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-3 px-3 py-2">
          <HudTitle projects={projects} noteCount={noteCount} />
        </CivPanel>
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-1 p-1">
          <AmbientHub projects={projects} variant="hud" />
          <SettingsMenu projects={projects} className="border-0 p-0" />
          {home && <AddProjectForm />}
        </CivPanel>
      </div>
      <CivToolbar cityCount={projects.length} noteCount={noteCount} routineCount={routineCount} />
    </>
  );
}
