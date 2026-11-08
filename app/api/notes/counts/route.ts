import { handle } from "@/lib/api/http";
import { projectNoteDirs, workspaceNoteDirs, repoDirsFor } from "@/lib/notes/resolve";
import { countNotes } from "@/lib/notes/store";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const projects = await listProjects();
  const counts = await Promise.all(projects.map(async (project) => {
    const workspaces = (await listWorkspaces(project.id)).filter((w) => w.status === "active");
    return [project.id, await countNotes([
      projectNoteDirs(project),
      ...await repoDirsFor(project),
      ...workspaces.map((w) => workspaceNoteDirs(project, w)),
    ])] as const;
  }));
  return Response.json({ counts: Object.fromEntries(counts) });
});
