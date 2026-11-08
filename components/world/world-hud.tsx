import { AmbientHub } from "@/components/ambient/ambient-hub";
import { SettingsMenu } from "@/components/ambient/settings-menu";
import { AddProjectForm } from "@/components/home/add-project-form";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { Logo } from "@/components/logo";
import { CivPanel } from "./civ-panel";
import { CivToolbar } from "./civ-toolbar";

/** Chrome over the world map: title, actions, and the bottom-left command menu. */
export function WorldHud({ projects }: { projects: SidebarProject[] }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4">
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-3 px-3 py-2">
          <h1>
            <span className="sr-only">Thunk</span>
            <Logo className="h-6 w-auto" />
          </h1>
          <span className="pixel text-muted-foreground border-l pl-3 text-sm">
            Known world · {projects.length} {projects.length === 1 ? "city" : "cities"}
          </span>
        </CivPanel>
        <CivPanel className="pointer-events-auto" bodyClassName="flex items-center gap-1 p-1">
          <AmbientHub projects={projects} variant="hud" />
          <SettingsMenu projects={projects} className="border-0 p-0" />
          <AddProjectForm />
        </CivPanel>
      </div>
      <CivToolbar cityCount={projects.length} />
    </>
  );
}
