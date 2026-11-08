import "server-only";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { createNote } from "@/lib/notes/store";
import { workspaceChanges } from "@/lib/projects/git";
import { workspacePrStatus } from "@/lib/projects/github";
import type { Project, Workspace } from "@/lib/projects/types";
import { findPrUrl, parseRoutineSummary } from "./prompt";
import { RUN_STATUS_LABELS, RUN_TRIGGER_LABELS, routineSlug, type Routine, type RoutineRun, type RunDiffStat, type RunStatus } from "./types";

export type RunReport = {
  summary: string;
  outcome: string | null;
  diffStat: RunDiffStat | null;
  prUrl: string | null;
};

/** What the run left behind: the agent's summary, the diff against the workspace base, and a PR if there is one. */
export async function collectReport(opts: { project: Project; workspace: Workspace | null; markdown: string }): Promise<RunReport> {
  const { project, workspace, markdown } = opts;
  const parsed = parseRoutineSummary(markdown);
  let diffStat: RunDiffStat | null = null;
  if (workspace && project.kind === "repo") {
    const changes = await workspaceChanges(workspace.cwd, workspace.baseRef).catch(() => null);
    if (changes)
      diffStat = {
        files: changes.files.length,
        additions: changes.additions,
        deletions: changes.deletions,
        paths: changes.files.slice(0, 50).map((f) => ({ path: f.path, status: f.status })),
      };
  }
  let prUrl = (parsed.pr && findPrUrl(parsed.pr)) || findPrUrl(markdown);
  if (!prUrl && workspace?.worktreePath && project.remote) {
    prUrl = (await workspacePrStatus({ cwd: workspace.cwd, defaultBranch: project.defaultBranch, baseRef: workspace.baseRef }).catch(() => null))?.pr?.url ?? null;
  }
  return { summary: parsed.summary, outcome: parsed.outcome, diffStat, prUrl };
}

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
};

/** A dated note in the project's notebook so the result outlives the run's workspace. */
export async function writeRunNote(opts: {
  project: Project;
  routine: Routine;
  run: RoutineRun;
  status: RunStatus;
  workspace: Workspace | null;
  workspaceKept: boolean;
  report: RunReport;
  error: string | null;
}) {
  const { project, routine, run, status, workspace, workspaceKept, report, error } = opts;
  const started = run.startedAt ? new Date(run.startedAt) : new Date(run.createdAt);
  const date = started.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const d = report.diffStat;
  const lines = [
    `- **Status:** ${RUN_STATUS_LABELS[status]}${report.outcome ? ` (${report.outcome})` : ""}`,
    `- **Trigger:** ${RUN_TRIGGER_LABELS[run.triggerSource]}`,
    `- **Workspace:** ${workspace ? `${workspace.name}${workspace.branch ? ` (\`${workspace.branch}\`)` : ""}${workspaceKept ? "" : " · removed, nothing changed"}` : "none"}`,
    `- **Duration:** ${duration(Date.now() - started.getTime())}`,
    `- **Cost:** $${run.costUsd.toFixed(4)}`,
    ...(d ? [`- **Changes:** ${d.files ? `+${d.additions} −${d.deletions} · ${d.files} ${d.files === 1 ? "file" : "files"}` : "none"}`] : []),
    ...(report.prUrl ? [`- **Pull request:** ${report.prUrl}`] : []),
    ...(run.sessionId && workspace && workspaceKept ? [`- **Session:** [open](/w/${workspace.id}/s/${run.sessionId})`] : []),
    ...(error ? [`- **Error:** ${error}`] : []),
  ];
  const markdown = [...lines, "", "## Summary", "", report.summary || "_The agent did not write a summary._", ""].join("\n");
  return createNote(projectNoteDirs(project), {
    title: `${routine.name} — ${date}`,
    tags: ["routine", routineSlug(routine.name)],
    markdown,
  });
}
