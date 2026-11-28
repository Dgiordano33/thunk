import "server-only";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/projects";
import { tryGit, workspaceChanges } from "@/lib/projects/git";
import { workspacePrStatus } from "@/lib/projects/github";
import { anchorTarget, workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { liveMeta } from "@/lib/agent";
import { getSessionRow } from "@/lib/db/repo/sessions";
import { getTask } from "@/lib/db/repo/tasks";
import { latestIntegrationForTask, type Integration } from "@/lib/db/repo/integrations";
import { resolveWhere } from "@/lib/notifications/service";
import { recordPrChecks, reviewEvidence } from "@/lib/evidence/service";
import { latestWorkerReport } from "@/lib/db/repo/worker-reports";
import { listTaskSources } from "@/lib/db/repo/task-sources";
import type { ReviewIntegration, ReviewState, ReviewTests } from "./types";

export class ReviewNotFound extends Error {}

/** The worker session behind a review card: its task and workspace. */
export async function reviewTarget(sessionId: string) {
  const session = liveMeta(sessionId) ?? await getSessionRow(sessionId);
  if (session?.origin?.kind !== "worker" || session.origin.scout) throw new ReviewNotFound("This session is not a worker with a branch");
  const task = await getTask(session.origin.taskId);
  if (!task) throw new ReviewNotFound("The worker's task no longer exists");
  const ctx = await getWorkspaceContext(session.workspaceId);
  if (!ctx) throw new ReviewNotFound("The worker's workspace no longer exists");
  return { session, task, ctx };
}

export function testsOf(tests: Integration["tests"]): ReviewTests {
  if (!tests) return { state: "not_run", command: null, detail: "No test result was recorded" };
  if (!("exitCode" in tests)) return { state: "not_run", command: null, detail: tests.reason };
  return { state: tests.exitCode === 0 ? "passed" : "failed", command: tests.command, detail: tests.output };
}

/** Current head of each of this workspace's branches, keyed by repo name. */
export async function branchHeads(ctx: WorkspaceContext) {
  const heads = new Map<string, string | null>();
  for (const t of workspaceRepoTargets(ctx)) if (t.branch) heads.set(`${t.name}:${t.branch}`, await tryGit(t.cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${t.branch}`]));
  return heads;
}

/** What the trial merge said about this task, and whether a branch has moved since. */
export function integrationFor(taskId: string, row: Integration, heads: Map<string, string | null>): ReviewIntegration {
  const conflicts = (row.conflicts ?? []).filter((c) => c.taskId === taskId).map((c) => ({ repo: c.repo, files: c.files }));
  const shas = (row.headShas ?? []).filter((h) => h.taskId === taskId);
  const outOfDate = shas.some((h) => heads.has(`${h.repo}:${h.branch}`) && heads.get(`${h.repo}:${h.branch}`) !== h.sha);
  return {
    id: row.id, workspaceId: row.workspaceId, branch: row.branch, createdAt: row.createdAt,
    merged: !conflicts.length && (row.merged ?? []).some((m) => m.taskId === taskId), conflicts, tests: testsOf(row.tests), outOfDate,
  };
}

/** Build the review card for a finished worker session. A merged pull request resolves its card. */
export async function reviewState(sessionId: string): Promise<ReviewState> {
  const { session, task, ctx } = await reviewTarget(sessionId);
  const targets = workspaceRepoTargets(ctx);
  const measured = (await Promise.all(targets.map((t) => workspaceChanges(t.cwd, t.baseRef).catch(() => null)))).filter((c) => c !== null);
  const changes = measured.length ? {
    files: measured.reduce((n, c) => n + c.files.length, 0),
    additions: measured.reduce((n, c) => n + c.additions, 0),
    deletions: measured.reduce((n, c) => n + c.deletions, 0),
  } : null;
  const latest = await latestIntegrationForTask(task.id);
  const heads = await branchHeads(ctx);
  const integration = latest ? integrationFor(task.id, latest, heads) : null;
  const anchor = anchorTarget(ctx);
  const pr = anchor?.worktreePath && anchor.remote
    ? await workspacePrStatus({ cwd: anchor.cwd, defaultBranch: anchor.defaultBranch, baseRef: anchor.baseRef }).catch(() => null)
    : null;
  if (pr?.pr?.state === "MERGED") await resolveWhere({ sessionId, kinds: ["review_ready"] });
  const current = [...heads.values()].filter((h): h is string => Boolean(h));
  if (pr?.pr?.state === "OPEN") await recordPrChecks(task, sessionId, pr.pr, current[0] ?? null).catch((err) => console.error("[thunk] PR check evidence failed", err));
  const evidence = await reviewEvidence(task, current);
  const stamp = (await latestWorkerReport(sessionId))?.sourceVersion ?? null;
  const sourceRow = stamp ? (await listTaskSources(task.id)).find((s) => s.kind === stamp.kind && s.sourceId === stamp.sourceId) : null;
  return {
    source: stamp ? { ...stamp, latest: Math.max(stamp.latest, sourceRow?.version ?? 0) } : null,
    taskId: task.id, taskTitle: task.title, sessionId, workspaceId: session.workspaceId, branch: ctx.workspace.branch, changes, integration, pr,
    criteria: task.criteria ?? null, criteriaVersion: task.criteriaVersion ?? 0, evidence,
  };
}
