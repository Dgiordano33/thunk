"use client";
import { ImportNotes } from "@/components/tasks/import-notes";
import { TaskBoard } from "@/components/tasks/task-board";

export function WorkspaceTasks({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  // Keyed by workspace so both start fresh when it changes; siblings need distinct keys.
  return <><ImportNotes key={`import:${workspaceId}`} workspaceId={workspaceId} /><TaskBoard key={`board:${workspaceId}`} projectId={projectId} workspaceId={workspaceId} /></>;
}
