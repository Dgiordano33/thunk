"use client";
import Link from "next/link";
import { ChiefPanel } from "@/components/project/chief-panel";
import { NewWorkspaceButton } from "@/components/project/new-workspace-button";
import type { Project } from "@/lib/projects/types";
import type { TownFarmhouse } from "@/components/town/town-view";
import { projectSectionPath } from "@/lib/routes";
import { useAmbient } from "@/lib/store/ambient-store";

export function ProjectHome({ project, workspaces, closeHref, counts }: {
  project: Project;
  workspaces: TownFarmhouse[];
  closeHref: string;
  counts: Record<string, number | undefined>;
}) {
  const sessions = useAmbient(s => s.sessions);
  return (
    <main className="h-dvh overflow-y-auto px-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <h1 className="mb-4 break-words text-xl">{project.name}</h1>
      <section className="mb-4 rounded-lg border p-4"><ChiefPanel projectId={project.id} /></section>
      <NewWorkspaceButton projectId={project.id} projectSlug={project.slug} projectName={project.name} repos={project.repos} />
      <h2 className="my-4 font-medium">Workspaces</h2>
      <div className="space-y-3">
        {workspaces.map(w => {
          const activity = sessions.filter(s => s.workspaceId === w.id);
          const waiting = activity.some(s => s.pending > 0);
          const running = activity.some(s => s.status === "running");
          return (
            <Link className="block rounded-lg border bg-background p-4" key={w.id} href={`${closeHref}?ws=${w.id}`}>
              <strong>{w.label}</strong>
              <p className="break-words text-sm">{[w.branch, `${w.sessionCount} ${w.sessionCount === 1 ? "session" : "sessions"}`].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-sm"><span className={waiting ? "text-amber-600" : running ? "text-emerald-600" : "text-muted-foreground"}>●</span> {waiting ? "Waiting" : running ? "Running" : "Idle"}</p>
            </Link>
          );
        })}
      </div>
      <div className="mt-4 divide-y">
        {([['library', 'Notes'], ['tasks', 'Tasks'], ['workshop', 'Routines'], ['vault', 'Vault'], ['center', 'Overview and settings']] as const).map(([key, label]) => (
          <Link key={key} className="block py-4" href={projectSectionPath(closeHref, key)}>{label} {counts[key] ?? ""} →</Link>
        ))}
        <p className="py-4 text-muted-foreground">Canvas · Desktop only</p>
      </div>
    </main>
  );
}
