import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CheckState, PrCheck, PullRequestInfo, WorkspacePrStatus } from "./types";

const exec = promisify(execFile);

async function run(cmd: string, args: string[], cwd: string) {
  const { stdout } = await exec(cmd, args, { cwd, maxBuffer: 1024 * 1024, timeout: 15_000 });
  return stdout.trim();
}

const PR_FIELDS = "number,url,state,title,isDraft,statusCheckRollup,reviewDecision,mergeable,mergeStateStatus";

export type RollupEntry =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);

export function toCheck(e: RollupEntry): PrCheck {
  if (e.__typename === "StatusContext") {
    const state: CheckState = e.state === "SUCCESS" ? "pass" : FAILED.has(e.state) ? "fail" : "pending";
    return { name: e.context, state, url: e.targetUrl };
  }
  const c = e.conclusion ?? "";
  const state: CheckState =
    e.status !== "COMPLETED" ? "pending" : FAILED.has(c) ? "fail" : c === "SKIPPED" ? "skipped" : "pass";
  return { name: e.name, state, url: e.detailsUrl };
}

/** Can this workspace open a PR, and does one already exist for its branch? */
export async function workspacePrStatus(opts: {
  cwd: string;
  defaultBranch: string | null;
  baseRef: string | null;
}): Promise<WorkspacePrStatus> {
  const branch = await run("git", ["symbolic-ref", "--short", "HEAD"], opts.cwd).catch(() => null);
  const base = opts.baseRef?.replace(/^origin\//, "") || opts.defaultBranch || "main";
  const no = (reason: string): WorkspacePrStatus => ({ branch, base, pr: null, canCreate: false, reason });

  if (!branch) return no("Not on a branch");
  if (!(await run("git", ["remote", "get-url", "origin"], opts.cwd).catch(() => null))) return no("No origin remote");
  if (branch === base || branch === opts.defaultBranch) return no(`On ${branch}: a PR needs its own branch`);

  let pr: PullRequestInfo | null = null;
  try {
    const raw = JSON.parse(await run("gh", ["pr", "view", branch, "--json", PR_FIELDS], opts.cwd)) as Omit<
      PullRequestInfo,
      "checks" | "reviewDecision"
    > & { statusCheckRollup: RollupEntry[] | null; reviewDecision: string };
    const { statusCheckRollup, reviewDecision, ...rest } = raw;
    pr = {
      ...rest,
      checks: (statusCheckRollup ?? []).map(toCheck).sort((a, b) => a.name.localeCompare(b.name)),
      reviewDecision: (reviewDecision || null) as PullRequestInfo["reviewDecision"],
    };
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    if (/ENOENT/.test(msg)) return no("GitHub CLI (gh) is not installed");
    if (/auth login|not logged/i.test(msg)) return no("Run `gh auth login` first");
    // "no pull requests found": nothing open yet, which is the normal case.
  }
  return { branch, base, pr, canCreate: !pr || pr.state !== "OPEN", reason: null };
}

/** Title and body for a workspace's PR: its worker's task and the summary of the latest report. */
async function pullRequestText(workspaceId: string, branch: string) {
  const { listSessions } = await import("@/lib/agent");
  const { getTask } = await import("@/lib/db/repo/tasks");
  const { latestWorkerReport } = await import("@/lib/db/repo/worker-reports");
  const { reportSummary } = await import("@/lib/review/types");
  const worker = (await listSessions({ workspaceId, limit: 50 })).find((s) => s.origin?.kind === "worker" && !s.origin.scout);
  const task = worker?.origin?.kind === "worker" ? await getTask(worker.origin.taskId) : null;
  const summary = worker ? reportSummary((await latestWorkerReport(worker.id))?.content) : null;
  const title = (task?.title || worker?.title || branch).slice(0, 200);
  const body = [summary ?? task?.body ?? "", task ? `Task: ${task.title} (${task.id})` : "", "Opened from Thunk."].filter(Boolean).join("\n\n");
  return { title, body };
}

/**
 * Push the workspace's branch and open a pull request for it, titled from its worker's report.
 * Only ever called from a person's click (POST /api/workspaces/[id]/pr); agents never open PRs this way.
 * Returns the existing PR when one is already open.
 */
export async function openPullRequest(workspaceId: string, opts: { repoId?: string | null } = {}): Promise<{ url: string; created: boolean; status: WorkspacePrStatus }> {
  const { getWorkspaceContext } = await import("@/lib/projects");
  const { findRepoTarget } = await import("./repo-targets");
  const ctx = await getWorkspaceContext(workspaceId);
  if (!ctx) throw new Error("Workspace not found");
  const target = findRepoTarget(ctx, opts.repoId);
  if (!target) throw new Error(opts.repoId ? "Repo not in this workspace" : "This workspace has no Git repository");
  const before = await workspacePrStatus({ cwd: target.cwd, defaultBranch: target.defaultBranch, baseRef: target.baseRef });
  if (before.pr?.state === "OPEN") return { url: before.pr.url, created: false, status: before };
  if (!before.canCreate || !before.branch) throw new Error(before.reason ?? "This workspace cannot open a pull request");
  const { title, body } = await pullRequestText(workspaceId, before.branch);
  const long = { cwd: target.cwd, maxBuffer: 1024 * 1024, timeout: 120_000 };
  await exec("git", ["push", "--set-upstream", "origin", before.branch], long);
  const { stdout } = await exec("gh", ["pr", "create", "--base", before.base, "--head", before.branch, "--title", title, "--body", body], long);
  const url = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
  const status = await workspacePrStatus({ cwd: target.cwd, defaultBranch: target.defaultBranch, baseRef: target.baseRef });
  return { url: status.pr?.url ?? url, created: true, status };
}
