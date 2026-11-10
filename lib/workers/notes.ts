import "server-only";
import { projectNoteDirs, repoDirsFor, workspaceNoteDirs } from "@/lib/notes/resolve";
import { readNote } from "@/lib/notes/store";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";
import type { Project } from "@/lib/projects/types";
import { INJECT_LIMIT } from "@/lib/notes/prompt";

export async function noteBrief(project: Project, id: string) {
  const repo = /^r:([0-9a-f-]{36}):(.+)$/i.exec(id);
  const dirs = repo ? (await repoDirsFor(project)).filter((d) => d.scope.id === repo[1]) : [projectNoteDirs(project), ...(await listWorkspaces(project.id)).map((w) => workspaceNoteDirs(project, w))];
  const matches = (await Promise.all(dirs.map((d) => readNote(d, repo?.[2] ?? id)))).filter((n) => n !== null);
  if (matches.length !== 1) throw new Error(matches.length ? "Note ID is ambiguous in this project" : "Note not found in this project");
  const note = matches[0];
  const body = note.markdown.length > INJECT_LIMIT ? `${note.markdown.slice(0, INJECT_LIMIT)}\n[Truncated; read the note path for the rest.]` : note.markdown;
  return { note, brief: `Note: ${note.title}\nPath: ${note.path}\nNote ID: ${id}\n\n${body}` };
}
