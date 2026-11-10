import "server-only";
import { getWorkspaceContext } from "@/lib/projects";
import { workspaceChanges } from "@/lib/projects/git";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";

export type Overlap = { taskId: string; title: string; paths: string[] };
type WorkerWorkspace = { taskId: string; title: string; workspaceId: string };

/** Every changed path in a workspace, keyed by repo so the same path in two repos never collides. */
async function changedPaths(workspaceId: string) {
  const ctx = await getWorkspaceContext(workspaceId);
  if (!ctx) return new Map<string, string>();
  const targets = workspaceRepoTargets(ctx).filter((t) => t.worktreePath);
  const paths = new Map<string, string>();
  for (const t of targets) {
    const changes = await workspaceChanges(t.cwd, t.baseRef).catch(() => null);
    for (const f of changes?.files ?? []) paths.set(`${t.id}:${f.path}`, targets.length > 1 ? `${t.name}/${f.path}` : f.path);
  }
  return paths;
}

/**
 * Files more than one open worker branch has touched, by task. Each branch is compared with its
 * own base, so two workers editing the same file shows up before either is merged.
 */
export async function workerOverlaps(workers: WorkerWorkspace[]): Promise<Map<string, Overlap[]>> {
  const changed = await Promise.all(workers.map(async (w) => ({ ...w, paths: await changedPaths(w.workspaceId) })));
  const result = new Map<string, Overlap[]>();
  for (const a of changed) for (const b of changed) {
    if (a.taskId === b.taskId || a.workspaceId === b.workspaceId) continue;
    const shared = [...a.paths.keys()].filter((key) => b.paths.has(key)).map((key) => a.paths.get(key)!);
    if (shared.length) result.set(a.taskId, [...(result.get(a.taskId) ?? []), { taskId: b.taskId, title: b.title, paths: shared.sort() }]);
  }
  return result;
}
