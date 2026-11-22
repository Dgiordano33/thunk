// Mirror the Linear issues assigned to you as tasks in one Thunk project. Pure: lib/integrations/linear/index.ts
// passes the real client and task storage; tests pass fakes.
//
// Linear is the source of truth. A task takes the issue's title, description, status and priority whenever the
// issue changed in Linear since Thunk last applied it (its updatedAt moved). Edits made in Thunk stay until then.
import type { NewTask } from "@/lib/db/repo/tasks";
import type { Task, TaskPriority, TaskStatus } from "@/lib/tasks/types";
import type { LinearClient, LinearIssue } from "./client";

export type SyncDeps = {
  client: LinearClient;
  listTasks: (projectId: string) => Promise<Task[]>;
  insertTask: (input: NewTask) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<Task | null>;
};
export type SyncResult = { imported: number; updated: number; closed: number };

/** Linear's workflow state types → task status. Linear has no "blocked". */
export function statusFor(issue: LinearIssue): TaskStatus {
  switch (issue.state.type) {
    case "started": return "in_progress";
    case "completed": return "done";
    case "canceled": return "cancelled";
    default: return "open"; // triage, backlog, unstarted
  }
}

/** Linear: 0 none, 1 urgent, 2 high, 3 medium, 4 low. Thunk: 0 none, 1 low, 2 medium, 3 high. */
export function priorityFor(issue: LinearIssue): TaskPriority {
  return ([0, 3, 3, 2, 1] as const)[issue.priority] ?? 0;
}

const fields = (issue: LinearIssue) => ({
  title: issue.title.trim().slice(0, 200) || issue.identifier,
  body: issue.description ? issue.description.slice(0, 20000) : null,
  status: statusFor(issue),
  priority: priorityFor(issue),
  external: { source: "linear" as const, id: issue.id, key: issue.identifier, url: issue.url, updatedAt: issue.updatedAt },
});

const isOpen = (t: Task) => t.status === "open" || t.status === "in_progress" || t.status === "blocked";

export async function syncLinearProject(deps: SyncDeps, projectId: string, teamId: string): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, updated: 0, closed: 0 };
  const [open, tasks] = await Promise.all([deps.client.myOpenIssues(teamId), deps.listTasks(projectId)]);
  const byIssue = new Map(tasks.flatMap((t) => (t.external?.source === "linear" ? [[t.external.id, t] as const] : [])));

  for (const issue of open) {
    const task = byIssue.get(issue.id);
    if (!task) {
      await deps.insertTask({ projectId, createdBy: "integration", ...fields(issue) });
      result.imported++;
    } else if (task.external?.updatedAt !== issue.updatedAt) {
      await deps.updateTask(task.id, fields(issue));
      result.updated++;
    }
  }

  // Open tasks whose issue left the open, assigned-to-you set: closed, reassigned or deleted in Linear.
  const seen = new Set(open.map((i) => i.id));
  const gone = tasks.filter((t) => t.external?.source === "linear" && isOpen(t) && !seen.has(t.external.id));
  if (gone.length) {
    const found = new Map((await deps.client.issuesByIds(gone.map((t) => t.external!.id))).map((i) => [i.id, i]));
    for (const task of gone) {
      const issue = found.get(task.external!.id);
      if (issue && task.external?.updatedAt === issue.updatedAt) continue;
      const status: TaskStatus = !issue ? "cancelled" : issue.assignee?.isMe ? statusFor(issue) : "cancelled";
      await deps.updateTask(task.id, issue ? { ...fields(issue), status } : { status });
      result.closed++;
    }
  }
  return result;
}

/** The worktree branch for a task's issue: Linear links PRs whose branch carries the issue key. */
export function linearBranch(key: string, title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `thunk/${key.toLowerCase()}${slug ? `-${slug}` : ""}`;
}
