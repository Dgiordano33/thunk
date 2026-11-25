import "server-only";
import { withFileLock, readOptional, replaceFile } from "@/lib/notes/file-write";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { createNote, readNote, writeNote } from "@/lib/notes/store";
import type { Project } from "@/lib/projects/types";
import { workspaceMemoryFile } from "@/lib/projects/paths";

export async function appendWorkLog(project: Project, entry: string) {
  const dirs = projectNoteDirs(project);
  const date = new Date().toISOString().slice(0, 10);
  const id = `work-log-${date}`;
  return withFileLock(`${dirs.notesDir}/${id}.append`, async () => {
    const note = await readNote(dirs, id);
    const line = `- ${new Date().toISOString()} ${entry}\n`;
    return note
      ? writeNote(dirs, id, { markdown: `${note.markdown.trimEnd()}\n${line}`, expectedUpdatedAt: note.updatedAt })
      : createNote(dirs, { id, title: `Work log ${date}`, markdown: line }, { keepId: true });
  });
}
/** The plan is the chief's workspace memory, which openChief carries over to the next chief. */
export async function saveChiefPlan(project: Project, workspaceSlug: string, plan: string) {
  const file = workspaceMemoryFile(project.dataKey, workspaceSlug);
  return withFileLock(file, async () => replaceFile(file, plan, await readOptional(file)));
}

/** Hand the plan from a retired chief workspace to its replacement. */
export async function carryChiefPlan(project: Project, fromSlug: string, toSlug: string) {
  const plan = await readOptional(workspaceMemoryFile(project.dataKey, fromSlug));
  if (plan) await saveChiefPlan(project, toSlug, plan);
}
