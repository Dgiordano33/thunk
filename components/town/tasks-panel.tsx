"use client";
import { ImportNotes } from "@/components/tasks/import-notes";
import { TaskBoard } from "@/components/tasks/task-board";
import type { Project, Workspace } from "@/lib/projects/types";
import { workspaceLabel } from "@/components/session/labels";
import { TownPanel } from "./town-panel";

export function TasksPanel({ project, workspaces, closeHref }: { project: Project; workspaces: Workspace[]; closeHref: string }) {
  return <TownPanel eyebrow="Town hall" title="Tasks" wide closeHref={closeHref}>
    <ImportNotes key={`import-${project.id}`} projectId={project.id} />
    <TaskBoard key={project.id} projectId={project.id} workspaces={workspaces.map((w) => ({ id: w.id, name: workspaceLabel(w) }))} />
  </TownPanel>;
}
