import { handle } from "@/lib/api/http";
import { projectNoteDirs, workspaceNoteDirs, repoNoteDirs } from "@/lib/notes/resolve";
import { listNotes, metaOf } from "@/lib/notes/store";
import type { NoteFolder } from "@/lib/notes/types";
import { listProjects } from "@/lib/db/repo/projects";
import { listWorkspaces } from "@/lib/db/repo/workspaces";
import { ensureHomeProject } from "@/lib/home/service";

export const dynamic = "force-dynamic";

/** Top-level notes first, then every project's notes and its active workspaces' notes, for the Library. */
export const GET = handle(async () => {
  const home = await ensureHomeProject();
  const projects = [home, ...await listProjects()];
  const folders: NoteFolder[] = await Promise.all(
    projects.map(async (project) => {
      // Top-level notes are the Home project's own notes; its workspace is internal.
      const workspaces = project.id === home.id ? [] : (await listWorkspaces(project.id))
        .filter((w) => w.status === "active")
        .sort((a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt));
      const [notes, wsNotes] = await Promise.all([
        listNotes(projectNoteDirs(project)),
        Promise.all(workspaces.map((w) => listNotes(workspaceNoteDirs(project, w)))),
      ]);
      return {
        project: { id: project.id, name: project.name },
        ...(project.id === home.id ? { home: true } : {}),
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
