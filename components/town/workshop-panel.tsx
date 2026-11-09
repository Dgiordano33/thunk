import { Suspense } from "react";
import { WorkshopRoutines } from "@/components/routines/workshop-routines";
import { isLocalWorkspace, workspaceLabel } from "@/components/session/labels";
import { env } from "@/lib/env";
import { gitRepos } from "@/lib/projects/repos";
import type { Project, WorkspaceSummary } from "@/lib/projects/types";
import { listRoutines } from "@/lib/supabase/repo/routines";
import { TownPanel } from "./town-panel";

/** The town Workshop: this project's routines, their form and run history. */
export async function WorkshopPanel({ project, workspaces, closeHref }: { project: Project; workspaces: WorkspaceSummary[]; closeHref: string }) {
  const routines = await listRoutines({ projectId: project.id }).catch(() => []);
  return (
    <TownPanel eyebrow="Workshop" title="Routines" closeHref={closeHref} wide>
      <Suspense>
        <WorkshopRoutines
          projectId={project.id}
          repo={gitRepos(project).length > 0}
          hasRemote={gitRepos(project).some((r) => r.remote)}
          workspaces={workspaces
            .filter((w) => w.status === "active")
            .map((w) => ({ id: w.id, label: workspaceLabel(w), inPlace: isLocalWorkspace(w) }))
            .sort((a, b) => Number(b.inPlace) - Number(a.inPlace))}
          defaultModel={env.DEFAULT_MODEL}
          initial={routines}
        />
      </Suspense>
    </TownPanel>
  );
}
