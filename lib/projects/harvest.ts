import "server-only";
import type { WorkspaceContext } from "./index";
import { projectNoteDirs, workspaceNoteDirs, migrateProjectNotes } from "../notes/resolve";
import { isNoteId, readNote, writeNote } from "../notes/store";
import { NoteConflictError, readOptional } from "../notes/file-write";
import { workspaceMemoryFile } from "./paths";
import { writeMemory } from "./memory";
import { headerOnly } from "./granary";
import { listTasks, updateTask } from "../db/repo/tasks";
import { emitNote } from "../notes/watch";

/** The log minus lines project memory already holds, so harvesting again doesn't repeat them. */
function unharvested(log: string, projectMemory: string) {
  const known = new Set(projectMemory.split("\n").map(line => line.trim()).filter(Boolean));
  const fresh = log.split("\n").filter(line => !known.has(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return headerOnly(fresh) ? "" : fresh;
}

export async function readHarvest({ project, workspace }: WorkspaceContext) {
  await migrateProjectNotes(project, { force: true });
  const memory = await readOptional(workspaceMemoryFile(project.dataKey, workspace.slug)) ?? "";
  const projectMemory = await readOptional(projectNoteDirs(project).memoryFile!) ?? "";
  return { memory, suggested: unharvested(memory, projectMemory), projectMemory, notes: [], empty: headerOnly(memory) };
}

export async function harvestWorkspace(ctx: WorkspaceContext, input: { memory: string | null; noteIds: string[] }) {
  await migrateProjectNotes(ctx.project, { force: true });
  const source = workspaceNoteDirs(ctx.project, ctx.workspace);
  const destination = projectNoteDirs(ctx.project);
  const selected = [];
  for (const id of [...new Set(input.noteIds)]) {
    if (!isNoteId(id) || id.toLowerCase() === "memory") throw new Error("Invalid harvest note id");
    const note = await readNote(source, id);
    if (!note) throw new NoteConflictError("A selected note moved or was deleted. Reload Harvest.");
    selected.push({ id, note });
  }
  // Compatibility for an already-open Harvest dialog: notes are already project-owned.
  const moved: { from: string; to: string }[] = [];
  for (const { id, note } of selected) {
    for (const task of await listTasks({ projectId: ctx.project.id, workspaceId: ctx.workspace.id })) {
      if (task.noteId === id || task.noteId === note.id) await updateTask(task.id, { noteId: note.id, workspaceId: null });
    }
    await writeNote(destination, note.id, { workspaceIds: (note.workspaceIds ?? []).filter((w) => w !== ctx.workspace.id) });
    moved.push({ from: id, to: note.id });
    emitNote({ scope: destination.scope, noteId: note.id, kind: "changed" });
  }

  const memory = input.memory?.trim();
  if (memory) {
    const file = destination.memoryFile!;
    for (let attempt = 0; ; attempt++) {
      const current = await readOptional(file) ?? "";
      if (current.includes(memory)) break;
      try {
        await writeMemory(file, `${current.trimEnd()}\n\n## Harvested from ${ctx.workspace.name.replace(/[\r\n]/g, " ")} · ${new Date().toISOString().slice(0, 10)}\n\n${memory}\n`, current);
        emitNote({ scope: destination.scope, noteId: "memory", kind: "changed" });
        break;
      } catch (err) { if (!(err instanceof NoteConflictError) || attempt > 0) throw err; }
    }
  }
  return { memory: memory || null, notes: moved };
}

export type HarvestData = Awaited<ReturnType<typeof readHarvest>>;
