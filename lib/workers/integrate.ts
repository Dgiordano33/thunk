import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWorkspace, getWorkspaceContext, type WorkspaceContext } from "@/lib/projects";
import { archiveWorkspace } from "@/lib/projects/archive";
import { git, tryGit } from "@/lib/projects/git";
import { readLifecycleConfig } from "@/lib/projects/lifecycle-config";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { sessionConfigRoot } from "@/lib/projects/repos";
import { processEnvironment } from "@/lib/projects/runtime";
import { getProject } from "@/lib/supabase/repo/projects";
import { appendWorkLog } from "./log";
import { ownedWorker } from "./service";
import { updateWorkerState } from "./state";

const exec = promisify(execFile);
export const INTEGRATION_TEST_MINUTES = 15;

export type IntegrationResult = {
  workspaceId: string; branch: string | null;
  merged: { taskId: string; title: string; repo: string; branch: string; uncommitted: boolean }[];
  conflicts: { taskId: string; title: string; repo: string; branch: string; files: string[] }[];
  tests: { command: string; exitCode: number; output: string } | { command: null; reason: string };
};

/** Fallback identity for merge commits on machines without a git user, without overriding one that is set. */
async function identity(cwd: string) {
  return (await tryGit(cwd, ["config", "user.email"])) ? [] : ["-c", "user.name=Thunk", "-c", "user.email=thunk@localhost"];
}

/**
 * Trial-merge worker branches, in order, into a fresh integration worktree and run the project's
 * test script there. Nothing is merged back: the integration branch is a preview the person can merge.
 * A branch that conflicts is skipped (the merge is aborted) and the rest are still tried.
 * The previous integration workspace for the project is archived.
 */
export async function integrateWorkers(projectId: string, taskIds: string[], { runTests = true } = {}): Promise<IntegrationResult> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const workers: { task: Awaited<ReturnType<typeof ownedWorker>>["task"]; ctx: WorkspaceContext }[] = [];
  for (const taskId of [...new Set(taskIds)]) {
    const { task, session } = await ownedWorker(projectId, taskId);
    if (session.origin?.kind !== "worker" || session.origin.scout) throw new Error(`${task.title} is a scout; it has no branch to integrate`);
    const ctx = await getWorkspaceContext(session.workspaceId);
    if (!ctx) throw new Error(`Workspace for ${task.title} no longer exists`);
    workers.push({ task, ctx });
  }
  if (!workers.length) throw new Error("Name at least one worker task to integrate");
  const repoIds = [...new Set(workers.flatMap(({ ctx }) => workspaceRepoTargets(ctx).filter((t) => t.branch).map((t) => t.id)))];
  if (!repoIds.length) throw new Error("These workers have no branches to integrate");
  const workspace = await createWorkspace({ projectId, name: `integration-${crypto.randomUUID().slice(0, 8)}`, repoIds, worktree: true, setup: runTests ? "await" : "skip" });
  const ictx = { project, workspace };
  const targets = workspaceRepoTargets(ictx);
  const result: IntegrationResult = { workspaceId: workspace.id, branch: workspace.branch, merged: [], conflicts: [], tests: { command: null, reason: "Tests not requested" } };
  for (const { task, ctx } of workers) {
    for (const source of workspaceRepoTargets(ctx)) {
      const target = targets.find((t) => t.id === source.id);
      if (!target || !source.branch) continue;
      const uncommitted = Boolean(await tryGit(source.cwd, ["status", "--porcelain"]));
      try {
        await git(target.cwd, [...await identity(target.cwd), "merge", "--no-ff", "--no-edit", "-m", `Integrate ${task.title}`, "--", source.branch]);
        result.merged.push({ taskId: task.id, title: task.title, repo: source.name, branch: source.branch, uncommitted });
      } catch {
        const files = ((await tryGit(target.cwd, ["diff", "--name-only", "--diff-filter=U"])) ?? "").split("\n").filter(Boolean);
        await tryGit(target.cwd, ["merge", "--abort"]);
        result.conflicts.push({ taskId: task.id, title: task.title, repo: source.name, branch: source.branch, files });
      }
    }
  }
  if (runTests) {
    const command = (await readLifecycleConfig(sessionConfigRoot(ictx))).scripts.test;
    if (!command) result.tests = { command: null, reason: "No scripts.test in thunk.json" };
    else {
      const shell = process.env.SHELL || "/bin/bash";
      const run = await exec(shell, ["-lc", command], { cwd: workspace.cwd, env: { ...process.env, ...processEnvironment(ictx, 0) }, timeout: INTEGRATION_TEST_MINUTES * 60_000, maxBuffer: 16 * 1024 * 1024 })
        .then(({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }))
        .catch((err: { code?: number | string; killed?: boolean; stdout?: string; stderr?: string }) => ({
          code: typeof err.code === "number" ? err.code : 1,
          output: `${err.stdout ?? ""}${err.stderr ?? ""}${err.killed ? `\n[Timed out after ${INTEGRATION_TEST_MINUTES} min]` : ""}`,
        }));
      result.tests = { command, exitCode: run.code, output: run.output.slice(-4000) };
    }
  }
  const replaced = await updateWorkerState(project, (s) => {
    const previous = s.integrations.filter((i) => i.workspaceId !== workspace.id);
    s.integrations = [{ workspaceId: workspace.id, taskIds: workers.map((w) => w.task.id), createdAt: new Date().toISOString() }];
    return previous;
  });
  for (const old of replaced) await archiveWorkspace(old.workspaceId).catch(() => {});
  const tests = "exitCode" in result.tests ? `tests exit ${result.tests.exitCode}` : result.tests.reason.toLowerCase();
  await appendWorkLog(project, `[chief] integration: ${result.merged.length} merged, ${result.conflicts.length} conflicting · ${tests} · /w/${workspace.id}`);
  return result;
}
