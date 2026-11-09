import { handle } from "@/lib/api/http";
import { projectNoteDirs, workspaceNoteDirs, repoNoteDirs } from "@/lib/notes/resolve";
import { listNotes, metaOf } from "@/lib/notes/store";
import type { NoteFolder } from "@/lib/notes/types";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

/** Every project's notes and its active workspaces' notes, for the Library. */
export const GET = handle(async () => {
  const projects = await listProjects();
  const folders: NoteFolder[] = await Promise.all(
    projects.map(async (project) => {
      const workspaces = (await listWorkspaces(project.id))
        .filter((w) => w.status === "active")
        .sort((a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt));
      const [notes, wsNotes] = await Promise.all([
        listNotes(projectNoteDirs(project)),
        Promise.all(workspaces.map((w) => listNotes(workspaceNoteDirs(project, w)))),
      ]);
      return {
        project: { id: project.id, name: project.name },
        notes: notes.map(metaOf),
        repos: await Promise.all(project.repoFolders.map(async (folder) => ({
          notebook: { ...folder, repoName: project.repos.find((r) => r.id === folder.repoId)!.name },
          notes: await repoNoteDirs(project, folder).then(listNotes).then((ns) => ns.map(metaOf)).catch(() => []),
        }))),
        workspaces: workspaces.map((w, i) => ({ workspace: { id: w.id, name: w.name, slug: w.slug }, notes: wsNotes[i].map(metaOf) })),
      };
    }),
  );
  return Response.json({ projects: folders });
});
