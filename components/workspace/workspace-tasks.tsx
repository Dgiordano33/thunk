"use client";
import { ImportNotes } from "@/components/tasks/import-notes";
import { TaskBoard } from "@/components/tasks/task-board";

export function WorkspaceTasks({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  return <><ImportNotes key={workspaceId} workspaceId={workspaceId} /><TaskBoard key={workspaceId} projectId={projectId} workspaceId={workspaceId} /></>;
}
