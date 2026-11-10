import "server-only";
import { getSession, listSessions } from "@/lib/agent";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/projects";
import { archiveWorkspace } from "@/lib/projects/archive";
import { git, tryGit, workspaceChanges } from "@/lib/projects/git";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { getProject, listProjects } from "@/lib/supabase/repo/projects";
import { getTask } from "@/lib/supabase/repo/tasks";
import { appendWorkLog } from "./log";
import { readWorkerState } from "./state";

/**
 * Whether every branch in the workspace is merged into its default branch (or the remote copy of it)
 * with nothing uncommitted. Squash merges count: merging the branch would change nothing.
 */
export async function workspaceMerged(ctx: WorkspaceContext) {
  for (const t of workspaceRepoTargets(ctx)) {
    if (!t.worktreePath) continue;
    if (await tryGit(t.cwd, ["status", "--porcelain"]) !== "") return false;
    if (!t.defaultBranch) return false;
    let merged = false;
    for (const target of [`refs/heads/${t.defaultBranch}`, `refs/remotes/origin/${t.defaultBranch}`]) {
      if (!(await tryGit(t.cwd, ["rev-parse", "--verify", "--quiet", target]))) continue;
      if (await tryGit(t.cwd, ["merge-base", "--is-ancestor", "HEAD", target]) !== null) { merged = true; break; }
      const tree = await tryGit(t.cwd, ["merge-tree", "--write-tree", target, "HEAD"]);
      if (tree && tree === await git(t.cwd, ["rev-parse", `${target}^{tree}`])) { merged = true; break; }
    }
    if (!merged) return false;
  }
  return true;
}

/** Nothing committed on the branch and nothing uncommitted: there is no work to keep. */
async function workspaceEmpty(ctx: WorkspaceContext) {
  for (const t of workspaceRepoTargets(ctx)) {
    if (!t.worktreePath) continue;
    const changes = await workspaceChanges(t.cwd, t.baseRef).catch(() => null);
    if (!changes || changes.files.length) return false;
  }
  return true;
}

export type CleanupReason = "merged" | "empty" | "race_lost";

/**
 * Archive worker workspaces that are finished: the task is done and its branch merged, the task was
 * cancelled with nothing on the branch, or the worker lost a race. Archiving closes sessions and keeps
 * the worktree and branch, so nothing is lost. Active sessions and the current integration are left alone.
 */
export async function cleanupWorkerWorkspaces(projectId?: string) {
  const projectIds = projectId ? [projectId] : (await listProjects()).map((p) => p.id);
  const archived: { projectId: string; workspaceId: string; reason: CleanupReason }[] = [];
  for (const id of projectIds) {
    const project = await getProject(id);
    if (!project) continue;
    const state = await readWorkerState(project);
    const sessions = await listSessions({ projectId: id, limit: 100_000 });
    const byWorkspace = new Map<string, typeof sessions>();
    for (const s of sessions) byWorkspace.set(s.workspaceId, [...(byWorkspace.get(s.workspaceId) ?? []), s]);
    for (const [workspaceId, list] of byWorkspace) {
      const workers = list.filter((s) => s.origin?.kind === "worker" && !s.origin.scout);
      // Only workspaces that exist for workers; one a person also worked in is theirs to archive.
      if (!workers.length || workers.length !== list.length) continue;
      if (list.some((s) => ["starting", "running", "awaiting"].includes(getSession(s.id)?.meta.status ?? ""))) continue;
      const ctx = await getWorkspaceContext(workspaceId);
      if (!ctx || ctx.workspace.slug === "main" || ctx.workspace.status === "archived") continue;
      let reason: CleanupReason | null = null;
      for (const s of workers) {
        if (s.origin?.kind !== "worker") continue;
        const race = s.origin.raceId ? state.races[s.origin.raceId] : undefined;
        if (race?.winner && race.winner !== s.id) { reason = "race_lost"; break; }
        const task = await getTask(s.origin.taskId);
        if (task?.sessionId && task.sessionId !== s.id) continue;
        if (task?.status === "done" && await workspaceMerged(ctx)) reason = "merged";
        else if ((!task || task.status === "cancelled" || task.status === "done") && await workspaceEmpty(ctx)) reason = "empty";
      }
      if (!reason) continue;
      try {
        await archiveWorkspace(workspaceId);
        archived.push({ projectId: id, workspaceId, reason });
        await appendWorkLog(project, `[thunk] archived worker workspace ${ctx.workspace.name} · ${reason.replace("_", " ")}`);
      } catch (err) { console.error("[thunk] worker workspace archive failed", workspaceId, err); }
    }
  }
  return archived;
}
