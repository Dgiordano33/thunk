import "server-only";
import type { SessionOrigin } from "@/lib/agent/types";
import { listMemoryProposals } from "@/lib/db/repo/memory-proposals";
import { listTasks } from "@/lib/db/repo/tasks";
import type { WorkspaceContext } from "@/lib/projects";
import { readMemory } from "@/lib/projects/memory";
import { projectMemoryFile, workspaceMemoryFile } from "@/lib/projects/paths";
import { savedReport } from "@/lib/workers/report-up";
import { readSidecar, sidecarFile } from "./sidecar";

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text;
const block = (tag: string, text: string, attrs = "") => `<${tag}${attrs}>\n${text.trim() || "(empty)"}\n</${tag}>`;

/** The brief for Harvest's proposal session: everything it needs inline, so the session is short. */
export async function harvestBrief({ project, workspace }: WorkspaceContext) {
  const [workspaceMemory, projectMemory, sidecar, tasks] = await Promise.all([
    readMemory(workspaceMemoryFile(project.dataKey, workspace.slug)),
    readMemory(projectMemoryFile(project.dataKey)),
    readSidecar(project.dataKey),
    listTasks({ projectId: project.id, workspaceId: workspace.id, status: ["done"] }),
  ]);
  const finished = await Promise.all(tasks.slice(0, 30).map(async (task) => {
    const report = task.sessionId ? await savedReport(project, task.sessionId).catch(() => null) : null;
    return block("task", [task.title, task.body ?? "", report ? `Report:\n${clip(report.content, 4000)}` : ""].filter(Boolean).join("\n\n"), ` id="${task.id}"${task.sessionId ? ` session="${task.sessionId}"` : ""}`);
  }));
  return [
    `# Propose a project memory update from workspace “${workspace.name}”`,
    "This workspace is closing out. Read what it learned and propose changes to project memory, then call memory_propose once. You are read-only: do not edit any file; the person reviews and applies your proposal.",
    "",
    "Project memory holds durable facts for the whole project: architecture, conventions, gotchas, decisions. Keep entries short; one fact per entry, in the file's existing style.",
    "- add: a new entry worth keeping across workspaces. Skip progress notes, task status and anything already in memory.",
    "- replace: when the workspace changed or corrected an existing entry. target is the exact existing text, copied character for character.",
    "- remove: an entry that is now wrong.",
    "Give each item a reason, a kind (decision: a durable choice or fact; workaround: a fix for something that may be fixed later) and its sources: the task ids below, this workspace (`" + workspace.id + "`), or session ids.",
    "If nothing is worth keeping, call memory_propose with no items. Finish with one line saying what you proposed.",
    "",
    block("workspace_memory", clip(workspaceMemory, 40_000), ` workspace="${workspace.id}"`),
    block("project_memory", clip(projectMemory, 60_000)),
    block("memory_sources", clip(JSON.stringify(sidecar, null, 2), 20_000), ` file="${sidecarFile(project.dataKey)}"`),
    finished.length ? `<finished_tasks>\n${finished.join("\n")}\n</finished_tasks>` : "<finished_tasks>(none)</finished_tasks>",
  ].join("\n");
}

/** Start the read-only proposal session in the workspace. Its memory_propose call puts the proposal in the Inbox. */
export async function startHarvestProposal(ctx: WorkspaceContext, opts: { model?: string } = {}) {
  const { startWorkerSession, sendBrief } = await import("@/lib/workers/start");
  const origin: SessionOrigin = { kind: "memory", purpose: "harvest" };
  const live = await startWorkerSession({ workspaceId: ctx.workspace.id, model: opts.model, permissionMode: "default", title: "Propose a memory update", origin });
  await sendBrief(live, await harvestBrief(ctx));
  return { sessionId: live.id };
}

/** Progress for the Harvest dialog: the proposal once it exists, or whether the session stopped without one. */
export async function harvestProposalStatus(sessionId: string) {
  const [proposal] = await listMemoryProposals({ sessionId });
  if (proposal) return { proposal, state: "proposed" as const };
  const { getSession } = await import("@/lib/agent");
  const live = getSession(sessionId);
  const status = live?.meta.status;
  const working = status === "starting" || status === "running";
  return { proposal: null, state: working ? "working" as const : status === "awaiting" ? "awaiting" as const : "stopped" as const };
}
