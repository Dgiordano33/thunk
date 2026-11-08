import "server-only";
import { closeSession, getSession, pushUserMessage, startSession, subscribe, type LiveSession } from "@/lib/agent";
import type { HarnessEvent } from "@/lib/agent/types";
import { createWorkspace, getWorkspaceContext, removeWorkspace, type WorkspaceContext } from "@/lib/projects";
import { archiveWorkspace } from "@/lib/projects/archive";
import { tryGit } from "@/lib/projects/git";
import { prepareWorkspace } from "@/lib/projects/runtime";
import type { Project, Workspace } from "@/lib/projects/types";
import { expandCommand } from "@/lib/prompts/context";
import { getProject } from "@/lib/supabase/repo/projects";
import { countRunsSince, insertRun, isSkip, startOfToday, updateRoutine, updateRun } from "@/lib/supabase/repo/routines";
import { upsertSession } from "@/lib/supabase/repo/sessions";
import { renderPrompt } from "./prompt";
import { collectReport, writeRunNote } from "./report";
import { routinesState as state, type ActiveRun } from "./state";
import { MAX_CONCURRENT_RUNS, routineSlug, type Routine, type RoutineRun, type RunStatus, type RunTrigger, type SessionOrigin } from "./types";

type Payload = Record<string, unknown> | null;

export class RunRejected extends Error {
  constructor(
    message: string,
    public status: 409 | 429,
    public run: RoutineRun | null = null,
  ) {
    super(message);
  }
}

/**
 * Gate automatic triggers: one run per routine, the daily limit, and global concurrency.
 * A declined firing is written as a cancelled "Skipped: …" row so it shows in history.
 */
export async function fire(routine: Routine, trigger: RunTrigger, payload: Payload = null): Promise<RoutineRun> {
  const reason = state.active.has(routine.id)
    ? "Skipped: the previous run is still in progress"
    : (await countRunsSince(routine.id, startOfToday())) >= routine.maxRunsPerDay
      ? `Skipped: daily limit of ${routine.maxRunsPerDay} runs reached`
      : state.active.size >= MAX_CONCURRENT_RUNS
        ? `Skipped: ${MAX_CONCURRENT_RUNS} routine runs already in progress`
        : null;
  if (reason) {
    const now = new Date().toISOString();
    const run = await insertRun({ routineId: routine.id, triggerSource: trigger, triggerPayload: payload, status: "cancelled", error: reason, finishedAt: now });
    console.log(`[thunk] routine "${routine.name}" ${reason.toLowerCase()}`);
    return run;
  }
  return startRun(routine, trigger, payload);
}

/** Insert the run and start it in the background. Throws RunRejected if the routine already has a run going. */
export async function startRun(routine: Routine, trigger: RunTrigger, payload: Payload = null): Promise<RoutineRun> {
  const existing = state.active.get(routine.id);
  if (existing) throw new RunRejected("This routine already has a run in progress", 409);
  // Reserve the slot before the first await so two triggers can't both start.
  const slot: ActiveRun = { runId: "", routineId: routine.id, sessionId: null, cancel: () => {} };
  state.active.set(routine.id, slot);
  let run: RoutineRun;
  try {
    run = await insertRun({ routineId: routine.id, triggerSource: trigger, triggerPayload: payload, status: "queued" });
  } catch (err) {
    state.active.delete(routine.id);
    throw err;
  }
  slot.runId = run.id;
  void execute(routine, run, trigger, payload, slot).catch((err) => console.error("[thunk] routine run crashed", err));
  return run;
}

/** Stop a run: close its session (the subscriber finalizes it), or mark it cancelled if it isn't live here. */
export async function cancelRun(runId: string, reason = "Cancelled by user"): Promise<boolean> {
  const active = [...state.active.values()].find((a) => a.runId === runId);
  if (active) {
    active.cancel(reason);
    return true;
  }
  const run = await updateRun(runId, { status: "cancelled", finishedAt: new Date().toISOString(), error: reason });
  return Boolean(run);
}

async function execute(routine: Routine, run: RoutineRun, trigger: RunTrigger, payload: Payload, slot: ActiveRun) {
  let cancelled: string | null = null;
  let project: Project | null = null;
  let workspace: Workspace | null = null;
  let live: LiveSession | null = null;
  slot.cancel = (reason) => {
    cancelled = reason;
    if (live) closeSession(live.id);
  };
  const bail = () => {
    if (cancelled) throw new Error(cancelled);
  };

  try {
    project = await getProject(routine.projectId);
    if (!project) throw new Error("Project not found");
    let ctx: WorkspaceContext | null;
    if (routine.targetKind === "workspace") {
      ctx = routine.targetWorkspaceId ? await getWorkspaceContext(routine.targetWorkspaceId) : null;
      if (!ctx) throw new Error("Target workspace no longer exists");
      if (ctx.workspace.status === "archived") throw new Error("Target workspace is archived");
    } else {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
      // Create without setup first so the run records its workspace even if setup fails.
      const ws = await createWorkspace({ projectId: project.id, name: `${routineSlug(routine.name)}-${stamp}`, setup: "skip" });
      ctx = { project, workspace: ws };
      workspace = ws;
      await updateRun(run.id, { workspaceId: ws.id });
      if (ws.worktreePath) await prepareWorkspace(ctx);
    }
    workspace = ctx.workspace;
    bail();
    await updateRun(run.id, { workspaceId: workspace.id, status: "running", startedAt: new Date().toISOString() });
    run = { ...run, workspaceId: workspace.id, status: "running", startedAt: new Date().toISOString() };

    const origin: SessionOrigin = { kind: "routine", routineId: routine.id, runId: run.id, routineName: routine.name };
    live = await startSession({ workspaceId: workspace.id, model: routine.model, permissionMode: routine.permissionMode, title: routine.name, origin });
    slot.sessionId = live.id;
    // The run row references the session; make sure it exists before linking (persistence upserts it again).
    await upsertSession(live.meta);
    await updateRun(run.id, { sessionId: live.id });
    run = { ...run, sessionId: live.id };
    bail();

    watch(live, routine, run, project, workspace, () => cancelled);
    const prompt = renderPrompt(routine.prompt, trigger, payload);
    pushUserMessage(live, prompt, { expandedContent: await expandCommand(prompt, project.root) });
  } catch (err) {
    if (live) closeSession(live.id);
    await finalize({
      routine,
      run,
      project,
      workspace,
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ?? (err as Error).message,
      markdown: "",
      costUsd: 0,
    });
  }
}

/** Follow the session's events and finalize the run when the agent finishes, errors, is closed or times out. */
function watch(live: LiveSession, routine: Routine, run: RoutineRun, project: Project, workspace: Workspace, cancelled: () => string | null) {
  let markdown = "";
  let costUsd = 0;
  let lastError: string | null = null;
  let status: RunStatus = "running";
  let done = false;

  const finish = (final: RunStatus, error: string | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
    void finalize({ routine, run, project, workspace, status: final, error, markdown, costUsd, sessionId: live.id }).catch((err) =>
      console.error("[thunk] routine finalize failed", err),
    );
  };

  const setStatus = (next: RunStatus) => {
    if (done || next === status) return;
    status = next;
    void updateRun(run.id, { status: next }).catch((err) => console.error("[thunk] routine run update failed", err));
  };

  const onEvent = (e: HarnessEvent) => {
    switch (e.type) {
      case "turn_complete":
        if (e.markdown) markdown = e.markdown;
        break;
      case "error":
        lastError = e.message;
        break;
      case "result":
        costUsd += e.costUsd || 0;
        if (live.pending.size === 0) finish(e.isError ? "failed" : "succeeded", e.isError ? lastError ?? `Agent stopped: ${e.subtype}` : null);
        break;
      case "status":
        if (e.state === "awaiting") setStatus("needs_attention");
        else if (e.state === "running" && status === "needs_attention") setStatus("running");
        else if (e.state === "error") finish("failed", lastError ?? "Session error");
        else if (e.state === "closed") finish("cancelled", cancelled() ?? "Session closed before the run finished");
        break;
    }
  };

  const unsubscribe = subscribe(live, onEvent);
  const timer = setTimeout(() => {
    if (done) return;
    void live.driver.interrupt().catch(() => {});
    finish("failed", `Timed out after ${routine.maxRunMinutes} min`);
  }, routine.maxRunMinutes * 60_000);
  timer.unref?.();
}

type FinalizeInput = {
  routine: Routine;
  run: RoutineRun;
  project: Project | null;
  workspace: Workspace | null;
  status: RunStatus;
  error: string | null;
  markdown: string;
  costUsd: number;
  sessionId?: string;
};

/** Write the report (summary, diff stat, PR, note), then tidy up an ephemeral worktree. */
const finalizing = new Set<string>();

async function finalize(input: FinalizeInput) {
  // The catch in execute and the session watcher can both get here; the first one wins. Ids stay (tiny) so late callers are ignored too.
  if (finalizing.has(input.run.id)) return;
  finalizing.add(input.run.id);
  const { routine, project, workspace, error, costUsd } = input;
  let { status } = input;
  try {
    const report = project ? await collectReport({ project, workspace, markdown: input.markdown }) : null;
    if (report?.outcome === "blocked" && status === "succeeded") report.summary = `Blocked: ${report.summary}`;

    // A fresh worktree that produced nothing is removed; anything else is kept (archived) for review.
    const ephemeral = routine.targetKind === "ephemeral" && workspace && workspace.slug !== "main";
    const nothing = report && (report.diffStat?.files ?? 0) === 0 && !report.prUrl;
    let workspaceKept = true;
    if (ephemeral && status === "succeeded") {
      if (nothing) {
        if (input.sessionId) closeSession(input.sessionId);
        workspaceKept = !(await removeWorkspace(workspace.id, { removeWorktree: true, removeMemory: true }).then(
          () => true,
          (err) => (console.error("[thunk] routine cleanup failed", err), false),
        ));
        // `-d` refuses unmerged branches, so this only drops the empty per-run branch.
        if (!workspaceKept && project && workspace.branch) await tryGit(project.root, ["branch", "-d", workspace.branch]);
      }
      if (workspaceKept) await archiveWorkspace(workspace.id).catch((err) => console.error("[thunk] routine archive failed", err));
    }

    const run = { ...input.run, costUsd, status };
    let noteId: string | null = null;
    if (project && report)
      noteId = await writeRunNote({ project, routine, run, status, workspace, workspaceKept, report, error })
        .then((n) => n.id)
        .catch((err) => (console.error("[thunk] routine note failed", err), null));

    await updateRun(run.id, {
      status,
      finishedAt: new Date().toISOString(),
      costUsd,
      summary: report?.summary || null,
      diffStat: report?.diffStat ?? null,
      prUrl: report?.prUrl ?? null,
      noteId,
      error,
      ...(workspaceKept ? {} : { workspaceId: null, sessionId: null }),
    });
    await updateRoutine(routine.id, { lastRunAt: new Date().toISOString() });
    console.log(`[thunk] routine "${routine.name}" ${status}${error ? `: ${error}` : ""}`);
  } catch (err) {
    status = "failed";
    console.error("[thunk] routine finalize failed", err);
    await updateRun(input.run.id, { status, finishedAt: new Date().toISOString(), error: (err as Error).message }).catch(() => {});
  } finally {
    if (state.active.get(routine.id)?.runId === input.run.id) state.active.delete(routine.id);
  }
}

/** Runs this process is driving, for reconcile. */
export function isRunActive(runId: string) {
  return [...state.active.values()].some((a) => a.runId === runId);
}

/** Session ids of live routine runs, so callers can check whether one is still attached. */
export function activeRunSession(routineId: string): LiveSession | null {
  const id = state.active.get(routineId)?.sessionId;
  return id ? (getSession(id) ?? null) : null;
}

export { isSkip };
