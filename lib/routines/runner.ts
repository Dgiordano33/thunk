import { startWorkerSession, sendBrief } from "@/lib/workers/start";
import { watchWorker } from "@/lib/workers/watch";
import "server-only";
import { closeSession, getSession, type LiveSession } from "@/lib/agent";
import { createWorkspace, getWorkspaceContext, removeWorkspace, type WorkspaceContext } from "@/lib/projects";
import { archiveWorkspace } from "@/lib/projects/archive";
import { tryGit } from "@/lib/projects/git";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { prepareWorkspace } from "@/lib/projects/runtime";
import type { Project, Workspace } from "@/lib/projects/types";
import { getProject } from "@/lib/supabase/repo/projects";
import { countRunsSince, insertRun, isSkip, startOfToday, updateRoutine, updateRun } from "@/lib/supabase/repo/routines";
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
  try {
    return await startRun(routine, trigger, payload);
  } catch (err) {
    if (!(err instanceof RunRejected)) throw err;
    const reason = `Skipped: ${err.message}`;
    const run = await insertRun({ routineId: routine.id, triggerSource: trigger, triggerPayload: payload, status: "cancelled", error: reason, finishedAt: new Date().toISOString() });
    console.log(`[thunk] routine "${routine.name}" ${reason.toLowerCase()}`);
    return run;
  }
}

/** Reserve before awaiting so every trigger shares the same concurrency and daily limits. */
export async function startRun(routine: Routine, trigger: RunTrigger, payload: Payload = null): Promise<RoutineRun> {
  if (state.active.has(routine.id)) throw new RunRejected("the previous run is still in progress", 409);
  if (state.active.size >= MAX_CONCURRENT_RUNS)
    throw new RunRejected(`${MAX_CONCURRENT_RUNS} routine runs already in progress`, 429);
  const slot: ActiveRun = { runId: "", routineId: routine.id, sessionId: null, cancel: () => {} };
  state.active.set(routine.id, slot);
  let run: RoutineRun;
  try {
    if (await countRunsSince(routine.id, startOfToday()) >= routine.maxRunsPerDay)
      throw new RunRejected(`daily limit of ${routine.maxRunsPerDay} runs reached`, 429);
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
      if (ws.branch) await prepareWorkspace(ctx);
    }
    workspace = ctx.workspace;
    bail();
    await updateRun(run.id, { workspaceId: workspace.id, status: "running", startedAt: new Date().toISOString() });
    run = { ...run, workspaceId: workspace.id, status: "running", startedAt: new Date().toISOString() };

    const origin: SessionOrigin = { kind: "routine", routineId: routine.id, runId: run.id, routineName: routine.name, trigger };
    live = await startWorkerSession({ workspaceId: workspace.id, model: routine.model, permissionMode: routine.permissionMode, title: routine.name, origin });
    slot.sessionId = live.id;
    // The run row references the session; make sure it exists before linking (persistence upserts it again).
    await updateRun(run.id, { sessionId: live.id });
    run = { ...run, sessionId: live.id };
    bail();

    watchWorker(live, routine.maxRunMinutes, {
      finish: (result) => finalize({ routine, run, project, workspace, ...result }),
      status: (status) => updateRun(run.id, { status }),
    }, () => cancelled);
    const prompt = renderPrompt(routine.prompt, trigger, payload);
    await sendBrief(live, prompt);
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

    // A fresh worktree whose successful run produced nothing is removed; anything else, failures included, is kept (archived) for review.
    const ephemeral = routine.targetKind === "ephemeral" && workspace && workspace.slug !== "main";
    const nothing = report && (report.diffStat?.files ?? 0) === 0 && !report.prUrl;
    let workspaceKept = true;
    if (ephemeral) {
      if (status === "succeeded" && nothing) {
        if (input.sessionId) closeSession(input.sessionId);
        workspaceKept = !(await removeWorkspace(workspace.id, { removeWorktree: true }).then(
          () => true,
          (err) => (console.error("[thunk] routine cleanup failed", err), false),
        ));
        // `-d` refuses unmerged branches, so this only drops the empty per-run branch.
        if (!workspaceKept && project) for (const t of workspaceRepoTargets({ project, workspace })) if (t.branch) await tryGit(t.root, ["branch", "-d", t.branch]);
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
