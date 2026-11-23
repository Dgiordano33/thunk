// Tell Linear what happened in Thunk, with Linear still the source of truth. Pure: lib/integrations/linear/service.ts
// passes the real client and settings; tests pass fakes.
//
// - A linked task moving to In progress moves an unstarted issue to the team's first "started" state.
// - A linked task marked Done closes its issue (the team's first "completed" state), unless a PR is attached:
//   then Linear's GitHub integration closes it when the PR merges.
// Each check reads the issue first, so changes the poller just copied from Linear are never echoed back.
import type { Task } from "@/lib/tasks/types";
import type { LinearClient, LinearIssueState } from "./client";

export type WriteBackDeps = {
  /** Null when there's no key or write-back is off. */
  client: () => Promise<LinearClient | null>;
  log?: (message: string, error?: unknown) => void;
};
export type WriteBackAction = "started" | "completed";

const OPEN_TYPES = new Set(["triage", "backlog", "unstarted"]);
const firstState = (issue: LinearIssueState, type: string) =>
  issue.states.filter((s) => s.type === type).sort((a, b) => a.position - b.position)[0] ?? null;

/** What to do for an issue whose task now has `status`, or null to leave it alone. */
export function plan(issue: LinearIssueState, status: Task["status"]): { action: WriteBackAction; stateId: string } | null {
  if (status === "in_progress" && OPEN_TYPES.has(issue.state.type)) {
    const state = firstState(issue, "started");
    return state ? { action: "started", stateId: state.id } : null;
  }
  if (status === "done" && issue.state.type !== "completed" && issue.state.type !== "canceled" && !issue.hasPullRequest) {
    const state = firstState(issue, "completed");
    return state ? { action: "completed", stateId: state.id } : null;
  }
  return null;
}

export function createLinearWriteBack(deps: WriteBackDeps) {
  const log = deps.log ?? ((message, error) => console.error(`[thunk] linear: ${message}`, error ?? ""));
  /** The status last acted on per task, so repeated change events for the same status cost no API calls. */
  const handled = new Map<string, Task["status"]>();
  const queue = new Map<string, Promise<unknown>>();

  async function apply(task: Task) {
    if (task.external?.source !== "linear") return null;
    if (task.status !== "in_progress" && task.status !== "done") { handled.delete(task.id); return null; }
    if (handled.get(task.id) === task.status) return null;
    const client = await deps.client();
    if (!client) return null;
    handled.set(task.id, task.status);
    if (handled.size > 5000) handled.delete(handled.keys().next().value!);
    try {
      const issue = await client.issueState(task.external.id);
      const step = issue && plan(issue, task.status);
      if (!step) return null;
      await client.moveIssue(task.external.id, step.stateId);
      return step.action;
    } catch (error) {
      handled.delete(task.id); // try again on the next change
      throw error;
    }
  }

  return {
    /** Act on a task's current state. Calls for one task run in order. */
    handle(task: Task): Promise<WriteBackAction | null> {
      const run = (queue.get(task.id) ?? Promise.resolve()).then(() => apply(task));
      const tail = run.catch((error) => log(`could not update ${task.external?.key ?? task.id}`, error)).finally(() => { if (queue.get(task.id) === tail) queue.delete(task.id); });
      queue.set(task.id, tail);
      return run;
    },
  };
}
