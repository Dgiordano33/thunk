import "server-only";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { createNote } from "@/lib/notes/store";
import type { Project, Workspace } from "@/lib/projects/types";
import { RUN_STATUS_LABELS, RUN_TRIGGER_LABELS, routineSlug, type Routine, type RoutineRun, type RunStatus } from "./types";

export { collectReport } from "@/lib/workers/report";
import type { RunReport } from "@/lib/workers/report";

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
