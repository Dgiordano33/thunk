import "server-only";
import { link, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceContext } from "./index";
import { projectNoteDirs, workspaceNoteDirs } from "../notes/resolve";
import { isNoteId, listNotes, metaOf, newNoteId } from "../notes/store";
import { NoteConflictError, readOptional, withFileLock } from "../notes/file-write";
import { writeMemory } from "./memory";
import { headerOnly } from "./granary";
import { listTasks, updateTask } from "../supabase/repo/tasks";
import { emitNote } from "../notes/watch";

/** The log minus lines project memory already holds, so harvesting again doesn't repeat them. */
function unharvested(log: string, projectMemory: string) {
  const known = new Set(projectMemory.split("\n").map(line => line.trim()).filter(Boolean));
  const fresh = log.split("\n").filter(line => !known.has(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return headerOnly(fresh) ? "" : fresh;
}

export async function readHarvest({ project, workspace }: WorkspaceContext) {
  const source = workspaceNoteDirs(project, workspace);
  const destination = projectNoteDirs(project);
  const [memory, projectMemory, notes] = await Promise.all([
    readOptional(source.memoryFile!), readOptional(destination.memoryFile!), listNotes(source, { withMemory: false }),
  ]);
  return { memory: memory ?? "", suggested: unharvested(memory ?? "", projectMemory ?? ""), projectMemory: projectMemory ?? "", notes: notes.map(metaOf), empty: headerOnly(memory ?? "") && !notes.length };
}

export async function harvestWorkspace(ctx: WorkspaceContext, input: { memory: string | null; noteIds: string[] }) {
  const source = workspaceNoteDirs(ctx.project, ctx.workspace);
  const destination = projectNoteDirs(ctx.project);
  const ids = [...new Set(input.noteIds)];
  for (const id of ids) {
    if (!isNoteId(id) || id.toLowerCase() === "memory") throw new Error("Invalid harvest note id");
    if (await readOptional(path.join(source.notesDir, `${id}.md`)) === null) throw new NoteConflictError("A selected note moved or was deleted. Reload Harvest.");
  }
  const moved: { from: string; to: string }[] = [];
  for (const id of ids) {
    const from = path.join(source.notesDir, `${id}.md`);
    await withFileLock(from, async () => {
      await mkdir(destination.notesDir, { recursive: true });
      let newId = id;
      for (;;) {
        try { await link(from, path.join(destination.notesDir, `${newId}.md`)); break; }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; newId = newNoteId(); }
      }
      const to = path.join(destination.notesDir, `${newId}.md`);
      const updated = [];
      try {
        const tasks = await listTasks({ projectId: ctx.project.id, workspaceId: ctx.workspace.id });
        for (const task of tasks.filter(t => t.noteId === id)) {
          await updateTask(task.id, { noteId: newId, workspaceId: null });
          updated.push(task);
        }
        // External editors may replace a file without taking our lock.
        if (await readOptional(from) !== await readOptional(to)) throw new NoteConflictError("Note changed during Harvest. Both copies were kept; review before retrying.");
        await unlink(from);
      } catch (err) {
        // Keep both files if rollback fails: a duplicate is safer than a broken task link.
        for (const task of updated) await updateTask(task.id, { noteId: id, workspaceId: task.workspaceId });
        if (!(err instanceof NoteConflictError)) await unlink(to);
        throw err;
      }
      moved.push({ from: id, to: newId });
      emitNote({ scope: source.scope, noteId: id, kind: "removed" });
      emitNote({ scope: destination.scope, noteId: newId, kind: "changed" });
    });
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
