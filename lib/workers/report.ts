import "server-only";
import { workspaceChanges } from "@/lib/projects/git";
import { workspacePrStatus } from "@/lib/projects/github";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import type { Project, Workspace } from "@/lib/projects/types";
import { findPrUrl, parseRoutineSummary } from "@/lib/routines/prompt";
import type { RunDiffStat } from "@/lib/routines/types";
export type RunReport = {
  summary: string;
  outcome: string | null;
  diffStat: RunDiffStat | null;
  prUrl: string | null;
};

/** What the run left behind: the agent's summary, the diff against the workspace base, and a PR if there is one. */
export async function collectReport(opts: { project: Project; workspace: Workspace | null; markdown: string }): Promise<RunReport> {
  const { project, workspace, markdown } = opts;
  const parsed = parseRoutineSummary(markdown.replace(/```worker-summary/g, "```routine-summary").replace(/^(branch|needs_person):.*$/gm, ""));
  let diffStat: RunDiffStat | null = null;
  const targets = workspace ? workspaceRepoTargets({ project, workspace }) : [];
  const perRepo = await Promise.all(targets.map(async (t) => ({ target: t, changes: await workspaceChanges(t.cwd, t.baseRef).catch(() => null) })));
  const measured = perRepo.flatMap(({ target, changes }) => (changes ? [{ target, changes }] : []));
  if (measured.length) {
    const files = measured.flatMap(({ target, changes }) => changes.files.map((f) => ({ path: targets.length > 1 ? `${target.name}/${f.path}` : f.path, status: f.status })));
    diffStat = {
      files: files.length,
      additions: measured.reduce((n, m) => n + m.changes.additions, 0),
      deletions: measured.reduce((n, m) => n + m.changes.deletions, 0),
      paths: files.slice(0, 50),
    };
  }
  let prUrl = (parsed.pr && findPrUrl(parsed.pr)) || findPrUrl(markdown);
  for (const t of targets) {
    if (prUrl) break;
    if (t.worktreePath && t.remote) prUrl = (await workspacePrStatus({ cwd: t.cwd, defaultBranch: t.defaultBranch, baseRef: t.baseRef }).catch(() => null))?.pr?.url ?? null;
  }
  return { summary: parsed.summary, outcome: parsed.outcome, diffStat, prUrl };
}

