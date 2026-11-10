import type { SessionOrigin } from "@/lib/agent/types";

export const CHIEF_TOOL_NAMES = ["delegate", "workers_status", "workers_message", "workers_stop", "chief_log"];
export const CHIEF_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit"];
export function chiefWriteCommand(tool: string, input: Record<string, unknown>) {
  return CHIEF_DISALLOWED_TOOLS.includes(tool) || (tool === "Bash" && /[>]|\b(?:tee|rm)\b|\bgit\s+(?:commit|push)\b/i.test(String(input.command ?? "")));
}
export function teamPrompt(origin?: SessionOrigin | null) {
  if (origin?.kind === "chief") return `# Project chief
You coordinate this project. Do not edit code or use shell commands to write files. Use delegate for implementation, one worker per task in a fresh worktree. Write self-contained briefs. delegate({ title, brief }) creates the task for you; tasks_create is not required first. repoIds is optional: omit it to use all project Git repositories. Never invent repository IDs. Use noteId when delegating a note; split unchecked checklist items into distinct tasks. At most four workers may run: when full, stop and wait for pushed reports, never poll.
Workers report by push. Judge each report against its task; use tasks_complete only when it meets the brief, otherwise workers_message or delegate again. Keep task statuses truthful. Questions and permissions go to the person. Bring decisions with a recommendation. Never merge automatically.
Use chief_log to record outcomes and decisions in today's Work log, and its plan argument to maintain workspace memory for a new chief. Read workspace memory at the start. Use workers_status for a snapshot only when useful.`;
  if (origin?.kind === "worker") return `# Project worker
You are working on task ${origin.taskId}${origin.chiefSessionId ? " for this project's chief" : " for the person"}. Do only this task. Commit code changes on the current branch. Do not switch branches, merge, or open a PR unless the brief asks. Questions and permissions go to the person. Leave final task acceptance to the chief when one exists.
End with a worker-summary fence containing:
\`\`\`worker-summary
outcome: done | blocked | failed
summary: What changed, checks performed, and limitations
branch: Current branch
needs_person: Optional decision needed
\`\`\``;
  return "";
}
