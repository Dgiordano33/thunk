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

type RollupEntry =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null };

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);

function toCheck(e: RollupEntry): PrCheck {
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
  if (branch === base || branch === opts.defaultBranch) return no(`On ${branch}: start a workspace with its own branch`);

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
