import "server-only";
import { harvestWorkspace } from "@/lib/projects/harvest";
import type { Project, Workspace } from "@/lib/projects/types";
import { workspaceNoteDirs } from "@/lib/notes/resolve";
import { listNotes } from "@/lib/notes/store";
import { listTasks, updateTask } from "@/lib/supabase/repo/tasks";
import type { Task } from "@/lib/tasks/types";

export type KeptNote = { id: string; title: string };

/**
 * A per-run worktree is removed or archived when the run ends, and the Library and Town hall only show
 * active workspaces. Move the notes and tasks the run left in its workspace up to the project first.
 * Workspace memory is left alone: removal keeps it in the granary.
 */
export async function keepRunOutputs(project: Project, workspace: Workspace): Promise<{ notes: KeptNote[] }> {
  const notes = await listNotes(workspaceNoteDirs(project, workspace), { withMemory: false }).catch(() => []);
  const titles = new Map(notes.map((n) => [n.id, n.title]));
  // Harvest first: it relinks tasks that point at a moved note. A failure there must not strand the tasks.
  const moved = notes.length
    ? await harvestWorkspace({ project, workspace }, { memory: null, noteIds: notes.map((n) => n.id) }).then(
        (r) => r.notes,
        (err) => (console.error("[thunk] routine notes not moved to the project", err), []),
      )
    : [];
  for (const task of await listTasks({ projectId: project.id, workspaceId: workspace.id }))
    await updateTask(task.id, { workspaceId: null });
  return { notes: moved.map((m) => ({ id: m.to, title: titles.get(m.from) ?? m.to })) };
}

/** Tasks the run's session created, and ones it owns that it moved on. */
export async function runTasks(projectId: string, sessionId: string | null | undefined): Promise<{ created: Task[]; updated: Task[] }> {
  if (!sessionId) return { created: [], updated: [] };
  const tasks = await listTasks({ projectId });
  const created = tasks.filter((t) => t.createdInSessionId === sessionId);
  const updated = tasks.filter((t) => t.createdInSessionId !== sessionId && t.sessionId === sessionId);
  return { created, updated };
}
