import { handle } from "@/lib/api/http";
import { listProjects } from "@/lib/db/repo/projects";
import { listAllWorkspaces } from "@/lib/db/repo/workspaces";
import { listTasks } from "@/lib/db/repo/tasks";
import { listRoutineRows } from "@/lib/db/repo/routines";
import { countNotes } from "@/lib/notes/store";
import { projectNoteDirs, workspaceNoteDirs, repoDirsFor } from "@/lib/notes/resolve";
import { listLiveSessions } from "@/lib/agent/session-registry";
import { hasDatabase } from "@/lib/db/server";
import { isHomeProject } from "@/lib/home/constants";
export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const [all, workspaces, tasks, routines] = await Promise.all([listProjects({ includeHome: true }), listAllWorkspaces(), listTasks(), listRoutineRows()]);
  const projects = all.filter((p) => !isHomeProject(p));
  const ids = new Set(projects.map((p) => p.id));
  const dirs = (await Promise.all(all.map(async (p) => [projectNoteDirs(p), ...await repoDirsFor(p), ...workspaces.filter((w) => w.projectId === p.id).map((w) => workspaceNoteDirs(p, w))]))).flat();
  const notes = await countNotes(dirs.map((d) => ({ ...d, memoryFile: undefined })));
  return Response.json({
    projects: projects.length,
    workspaces: workspaces.filter((w) => ids.has(w.projectId) && w.slug !== "main").length,
    sessions: hasDatabase() ? projects.reduce((n, p) => n + p.sessionCount, 0) : listLiveSessions().filter((s) => ids.has(s.meta.projectId ?? "")).length,
    notes,
    tasksOrRoutines: tasks.length + routines.length,
  });
});
