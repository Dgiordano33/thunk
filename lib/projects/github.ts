import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestInfo, WorkspacePrStatus } from "./types";

const exec = promisify(execFile);

async function run(cmd: string, args: string[], cwd: string) {
  const { stdout } = await exec(cmd, args, { cwd, maxBuffer: 1024 * 1024, timeout: 15_000 });
  return stdout.trim();
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
    const json = await run("gh", ["pr", "view", branch, "--json", "number,url,state,title,isDraft"], opts.cwd);
    pr = JSON.parse(json) as PullRequestInfo;
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? err);
    if (/ENOENT/.test(msg)) return no("GitHub CLI (gh) is not installed");
    if (/auth login|not logged/i.test(msg)) return no("Run `gh auth login` first");
    // "no pull requests found": nothing open yet, which is the normal case.
  }
  return { branch, base, pr, canCreate: !pr || pr.state !== "OPEN", reason: null };
}
