import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { listSessions } from "@/lib/agent";
import { insertEvidence, listEvidence } from "@/lib/db/repo/task-evidence";
import { getTask } from "@/lib/db/repo/tasks";
import { listWorkspaces } from "@/lib/db/repo/workspaces";
import { commandShell } from "@/lib/host/shell";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import type { WorkspaceContext } from "@/lib/projects";
import { tryGit } from "@/lib/projects/git";
import { readLifecycleConfig } from "@/lib/projects/lifecycle-config";
import { projectConfigDir } from "@/lib/projects/paths";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { sessionConfigRoot } from "@/lib/projects/repos";
import { processEnvironment } from "@/lib/projects/runtime";
import type { DeliveryEvent } from "@/lib/projects/delivery-types";
import type { Project, PullRequestInfo } from "@/lib/projects/types";
import type { Task } from "@/lib/tasks/types";
import type { HeadSha } from "@/lib/db/repo/integrations";
import type { IntegrationResult } from "@/lib/workers/integrate";
import { parseClaimedEvidence, staleness, type NewEvidence, type ReviewEvidence } from "./types";

const exec = promisify(execFile);
export const FINISH_TEST_MINUTES = 15;

// Per-project review settings, in the project's config directory. Off until the person turns them on.
const ReviewSettings = z.object({ testOnFinish: z.boolean().default(false) });
export type ReviewSettings = z.infer<typeof ReviewSettings>;
const settingsFile = (project: Pick<Project, "dataKey">) => path.join(projectConfigDir(project.dataKey), "review.json");
export async function readReviewSettings(project: Pick<Project, "dataKey">): Promise<ReviewSettings> {
  const text = await readOptional(settingsFile(project)).catch(() => null);
  try { return ReviewSettings.parse(text ? JSON.parse(text) : {}); } catch { return ReviewSettings.parse({}); }
}
export async function writeReviewSettings(project: Pick<Project, "dataKey">, patch: Partial<ReviewSettings>): Promise<ReviewSettings> {
  const file = settingsFile(project);
  return withFileLock(file, async () => {
    const previous = await readOptional(file);
    const next = ReviewSettings.parse({ ...(previous ? JSON.parse(previous) : {}), ...patch });
    await replaceFile(file, JSON.stringify(next, null, 2), previous);
    return next;
  });
}

/** The head commit of each of the workspace's branches. */
export async function workspaceHeads(ctx: WorkspaceContext): Promise<string[]> {
  const heads: string[] = [];
  for (const t of workspaceRepoTargets(ctx)) {
    const sha = await tryGit(t.cwd, ["rev-parse", "--verify", "--quiet", t.branch ? `refs/heads/${t.branch}` : "HEAD"]);
    if (sha) heads.push(sha);
  }
  return heads;
}

const base = (task: Task, sessionId: string | null, commitSha: string | null) => ({ taskId: task.id, criteriaVersion: task.criteriaVersion ?? 0, sessionId, commitSha });

/** Claimed rows from a worker's report: one per evidence line in its worker-summary block. */
export async function recordClaimed(task: Task, sessionId: string, markdown: string, commitSha: string | null) {
  const lines = parseClaimedEvidence(markdown, task.criteria ?? []);
  return insertEvidence(lines.map((l) => ({ ...base(task, sessionId, commitSha), ...l, origin: "claimed" as const })));
}

/** Observed rows from a trial merge: whether each task's branch merged, and the test result. */
export async function recordIntegration(result: IntegrationResult, headShas: HeadSha[]) {
  const ids = [...new Set([...result.merged, ...result.conflicts].map((r) => r.taskId))];
  const rows: NewEvidence[] = [];
  for (const taskId of ids) {
    const task = await getTask(taskId);
    if (!task) continue;
    const sha = headShas.find((h) => h.taskId === taskId)?.sha ?? null;
    const conflicts = result.conflicts.filter((c) => c.taskId === taskId);
    rows.push({ ...base(task, null, sha), criterionId: null, origin: "observed", type: "merge", status: conflicts.length ? "fail" : "pass",
      detail: conflicts.length ? `Conflicts in ${conflicts.flatMap((c) => c.files).join(", ") || "files not reported"}` : "Merged cleanly in a trial merge", ref: `/w/${result.workspaceId}` });
    const tests = result.tests;
    rows.push({ ...base(task, null, sha), criterionId: null, origin: "observed", type: "test",
      status: "exitCode" in tests ? tests.exitCode === 0 ? "pass" : "fail" : "unknown",
      detail: "exitCode" in tests ? `${tests.command} exited ${tests.exitCode} in the trial merge` : tests.reason, ref: `/w/${result.workspaceId}` });
  }
  return insertEvidence(rows);
}

/** Worker tasks whose workspace is on this branch. */
async function tasksOnBranch(projectId: string, branch: string) {
  const out: { task: Task; sessionId: string }[] = [];
  for (const w of await listWorkspaces(projectId)) {
    if (w.branch !== branch && !w.repos.some((r) => r.branch === branch)) continue;
    for (const s of await listSessions({ workspaceId: w.id, limit: 50 })) {
      if (s.origin?.kind !== "worker" || s.origin.scout) continue;
      const task = await getTask(s.origin.taskId);
      if (task && !out.some((o) => o.task.id === task.id)) out.push({ task, sessionId: s.id });
    }
  }
  return out;
}

/** Observed rows from the delivery poller: PR checks settling, and a preview deployment. */
export async function recordDelivery(projectId: string, events: DeliveryEvent[]) {
  const rows: NewEvidence[] = [];
  for (const e of events) {
    if (e.type !== "ci_passed" && e.type !== "ci_failed" && !(e.type === "deploy_ready" && e.previewUrl)) continue;
    for (const { task, sessionId } of await tasksOnBranch(projectId, e.branch)) {
      if (e.type === "deploy_ready") { rows.push({ ...base(task, sessionId, e.pr.head), criterionId: null, origin: "observed", type: "preview", status: "pass", detail: `Preview deployed for #${e.pr.number}`, ref: e.previewUrl }); continue; }
      const failed = e.checks.filter((c) => c.state === "fail").map((c) => c.name);
      rows.push({ ...base(task, sessionId, e.pr.head), criterionId: null, origin: "observed", type: "ci", status: e.type === "ci_passed" ? "pass" : "fail",
        detail: e.type === "ci_passed" ? `${e.checks.filter((c) => c.state === "pass").length} checks passed on #${e.pr.number}` : `Failing on #${e.pr.number}: ${failed.join(", ") || "checks"}`,
        ref: e.checks.find((c) => c.state === "fail" && c.url)?.url ?? e.pr.url });
    }
  }
  return insertEvidence(rows);
}

/**
 * When the project turns it on, run thunk.json's scripts.test in the worker's workspace after it finishes
 * and record the result as observed. Off by default; nothing runs unless the person enabled it.
 */
export async function runTestsOnFinish(ctx: WorkspaceContext, task: Task, sessionId: string) {
  if (!(await readReviewSettings(ctx.project)).testOnFinish) return null;
  const command = (await readLifecycleConfig(sessionConfigRoot(ctx))).scripts.test;
  if (!command) return null;
  const commitSha = (await workspaceHeads(ctx))[0] ?? null;
  const shell = commandShell(command);
  const run = await exec(shell.file, shell.args, { cwd: ctx.workspace.cwd, env: { ...process.env, ...processEnvironment(ctx, 0) }, windowsVerbatimArguments: shell.verbatim, timeout: FINISH_TEST_MINUTES * 60_000, maxBuffer: 16 * 1024 * 1024 })
    .then(() => ({ code: 0, killed: false }))
    .catch((err: { code?: number | string; killed?: boolean }) => ({ code: typeof err.code === "number" ? err.code : 1, killed: Boolean(err.killed) }));
  const [row] = await insertEvidence([{ ...base(task, sessionId, commitSha), criterionId: null, origin: "observed", type: "test", status: run.code === 0 ? "pass" : "fail",
    detail: run.killed ? `${command} timed out after ${FINISH_TEST_MINUTES} min in the worker's workspace` : `${command} exited ${run.code} in the worker's workspace`, ref: null }]);
  return row;
}

/** Observed PR checks, read when the review card loads: recorded once per head commit and result. */
export async function recordPrChecks(task: Task, sessionId: string, pr: PullRequestInfo, commitSha: string | null) {
  if (!pr.checks.length || pr.checks.some((c) => c.state === "pending")) return null;
  const failed = pr.checks.filter((c) => c.state === "fail");
  const status = failed.length ? "fail" as const : "pass" as const;
  if ((await listEvidence(task.id)).some((e) => e.type === "ci" && e.origin === "observed" && e.commitSha === commitSha && e.status === status)) return null;
  const [row] = await insertEvidence([{ ...base(task, sessionId, commitSha), criterionId: null, origin: "observed", type: "ci", status,
    detail: failed.length ? `Failing on #${pr.number}: ${failed.map((c) => c.name).join(", ")}` : `${pr.checks.filter((c) => c.state === "pass").length} checks passed on #${pr.number}`,
    ref: failed.find((c) => c.url)?.url ?? pr.url }]);
  return row;
}

/** A task's evidence for the review card, each row marked when it covers an older revision. */
export async function reviewEvidence(task: Task, heads: string[]): Promise<ReviewEvidence[]> {
  return (await listEvidence(task.id)).map((e) => ({ ...e, stale: staleness(e, heads, task.criteriaVersion ?? 0) }));
}
