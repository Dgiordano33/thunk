import "server-only";
import { closeSession, getSession, listSessions, listLiveSessions, onSessionCreated, resumeSession, pushUserMessage, subscribe, type LiveSession } from "@/lib/agent";
import { createWorkspace, ensureMainWorkspace, getWorkspaceContext } from "@/lib/projects";
import { getProject, listProjects } from "@/lib/supabase/repo/projects";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
import { subscribeTasks } from "@/lib/tasks/events";
import { getTask, listTasks } from "@/lib/supabase/repo/tasks";
import { createTask, patchTask } from "@/lib/tasks/service";
import { withFileLock } from "@/lib/notes/file-write";
import { loadEvents } from "@/lib/supabase/repo/messages";
import { notify } from "@/lib/notifications/service";
import { routineSlug } from "@/lib/routines/types";
import type { SessionMeta } from "@/lib/agent/types";
import { startWorkerSession, sendBrief } from "./start";
import { watchWorker, type WorkerResult } from "./watch";
import { collectReport } from "./report";
import { appendWorkLog } from "./log";
import { noteBrief } from "./notes";
import { currentChiefId, enqueue, queueReport, reportFile, savedReport, savedReports } from "./report-up";

export const MAX_WORKERS_PER_PROJECT = 4;
import { DelegateSchema, type DelegateInput } from "./schema";
import { readWorkerState, summarizeStats, updateWorkerState, type RaceEntry } from "./state";
import { workerOverlaps } from "./conflicts";
import { sessionPath } from "@/lib/routes";
import type { Project } from "@/lib/projects/types";
import type { Task } from "@/lib/tasks/types";
const g = globalThis as typeof globalThis & { __thunkWorkerWatchers?: WeakSet<LiveSession>; __thunkWorkerHousekeeping?: { unsubscribe: () => void; timer: ReturnType<typeof setInterval> } };
const watched = g.__thunkWorkerWatchers ??= new WeakSet();

export async function openChief(projectId: string, fresh = false) {
  return withFileLock(`chief:${projectId}`, async () => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Project not found");
    const workspace = await ensureMainWorkspace(project);
    if (!fresh) {
      const current = (await listSessions({ workspaceId: workspace.id, limit: 10_000 })).find((s) => s.origin?.kind === "chief");
      if (current) {
        const live = await resumeSession(current.id);
        if (live) return live;
      }
    }
    return startWorkerSession({ workspaceId: workspace.id, title: "Chief", permissionMode: "default", origin: { kind: "chief" } });
  });
}

const ACTIVE_STATES = ["starting", "running", "awaiting"];
const activeWorkers = (projectId: string) => listLiveSessions().filter((s) => s.meta.projectId === projectId && s.meta.origin?.kind === "worker" && ACTIVE_STATES.includes(s.meta.status)).length;
const shortId = () => crypto.randomUUID().slice(0, 8);

/** Dependencies not yet accepted (`waiting`) and ones that can never be (`failed`: cancelled or gone). */
async function dependencyState(projectId: string, dependsOn: string[]) {
  const waiting: string[] = [];
  const failed: string[] = [];
  for (const id of dependsOn) {
    const dep = await getTask(id);
    if (!dep || dep.projectId !== projectId || dep.status === "cancelled") failed.push(id);
    else if (dep.status !== "done") waiting.push(id);
  }
  return { waiting, failed };
}

/**
 * Start a task now, or queue it until a worker slot frees and its dependencies are done.
 * Queued tasks start on their own; the result says which happened.
 */
export async function delegate(projectId: string, chiefSessionId: string | null, input: DelegateInput) {
  const args = DelegateSchema.parse(input);
  return withFileLock(`delegate:${projectId}`, async () => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Project not found");
    if (chiefSessionId) {
      const chief = getSession(chiefSessionId);
      if (chief?.meta.projectId !== projectId || chief.meta.origin?.kind !== "chief") throw new Error("Only this project's chief can delegate");
    }
    if (args.repoIds?.some((id) => !project.repos.some((r) => r.id === id))) throw new Error("Repository does not belong to project");
    if (args.workspaceId) await workerTarget(projectId, args.workspaceId);
    else if ((args.mode ?? "worktree") === "worktree") selectRepos(project, args.repoIds);
    let task = args.taskId ? await getTask(args.taskId) : null;
    if (args.taskId && (!task || task.projectId !== projectId)) throw new Error("Task not found in this project");
    const owner = task?.sessionId && getSession(task.sessionId);
    if (owner && owner.id !== chiefSessionId && ACTIVE_STATES.includes(owner.meta.status)) throw new Error("Task already has an active session");
    const state = await readWorkerState(project);
    if (task && state.queue.some((q) => q.taskId === task!.id)) throw new Error("Task is already queued");
    const dependsOn = [...new Set(args.dependsOn ?? [])];
    if (task && dependsOn.includes(task.id)) throw new Error("A task cannot depend on itself");
    const deps = await dependencyState(projectId, dependsOn);
    if (deps.failed.length) throw new Error(`Dependencies are cancelled or not in this project: ${deps.failed.join(", ")}`);
    const noteId = args.noteId ?? task?.noteId;
    const note = noteId ? await noteBrief(project, noteId) : null;
    if (!task) task = await createTask({ projectId, title: args.title ?? note?.note.title.slice(0, 200) ?? "Delegated task", body: args.brief ?? null, noteId }, { createdBy: chiefSessionId ? "agent" : "user", createdInSessionId: chiefSessionId });
    const need = args.race?.length ?? 1;
    const free = MAX_WORKERS_PER_PROJECT - activeWorkers(projectId);
    if (deps.waiting.length || free < need) {
      const queued = task;
      await updateWorkerState(project, (s) => { s.queue.push({ taskId: queued.id, chiefSessionId, input: { ...args, taskId: queued.id, ...(noteId ? { noteId } : {}) }, dependsOn, queuedAt: new Date().toISOString() }); });
      const reason = deps.waiting.length ? `waiting for ${deps.waiting.join(", ")}` : `${MAX_WORKERS_PER_PROJECT - free} of ${MAX_WORKERS_PER_PROJECT} workers busy`;
      await appendWorkLog(project, `[chief] queued: ${task.title} (${task.id}) · ${reason}`);
      return { taskId: task.id, queued: true as const, reason, position: state.queue.length + 1 };
    }
    await appendWorkLog(project, `[chief] queued: ${task.title} (${task.id})`);
    return launch(project, task, args, chiefSessionId, note);
  });
}

function selectRepos(project: Project, repoIds?: string[]) {
  const selected = project.repos.filter((r) => repoIds ? repoIds.includes(r.id) : r.kind === "repo");
  if (!selected.length || selected.some((r) => r.kind !== "repo")) throw new Error("Delegation needs a Git repository for an isolated worktree. Use mode \"scout\" for read-only work.");
  return selected;
}

async function workerTarget(projectId: string, workspaceId: string) {
  const target = await getWorkspace(workspaceId);
  if (!target || target.projectId !== projectId) throw new Error("Workspace not found in this project");
  if (target.status === "archived") throw new Error("Workspace is archived");
  if (listLiveSessions().some((s) => s.meta.workspaceId === target.id && s.meta.origin?.kind === "worker" && ACTIVE_STATES.includes(s.meta.status)))
    throw new Error("Workspace already has an active worker; message it or wait for its report");
  return target;
}

/** Create the worker workspace(s) and session(s) for a task. Caller holds the project's delegate lock. */
async function launch(project: Project, task: Task, args: DelegateInput, chiefSessionId: string | null, note: Awaited<ReturnType<typeof noteBrief>> | null) {
  const projectId = project.id;
  const scout = args.mode === "scout";
  const noteId = args.noteId ?? task.noteId;
  const raceId = args.race ? crypto.randomUUID() : undefined;
  const models = args.race ?? [args.model];
  const started: LiveSession[] = [];
  try {
    const target = args.workspaceId ? await workerTarget(projectId, args.workspaceId) : null;
    const entries: RaceEntry[] = [];
    for (const model of models) {
      const workspace = scout ? await ensureMainWorkspace(project)
        : target ?? await createWorkspace({ projectId, name: `${routineSlug(task.title)}-${shortId()}`, repoIds: selectRepos(project, args.repoIds).map((r) => r.id), worktree: true, setup: "await" });
      const live = await startWorkerSession({ workspaceId: workspace.id, title: raceId ? `${task.title} · ${model}` : task.title, model, permissionMode: scout ? "default" : args.permissionMode ?? "default",
        origin: { kind: "worker", chiefSessionId, taskId: task.id, ...(target ? { existingWorkspace: true } : {}), ...(scout ? { scout: true } : {}), ...(raceId ? { raceId } : {}) } });
      started.push(live);
      entries.push({ sessionId: live.id, workspaceId: workspace.id, model: live.meta.model });
    }
    const [first] = started;
    await patchTask(task.id, { workspaceId: first.meta.workspaceId, sessionId: first.id, status: "in_progress", ...(noteId ? { noteId } : {}) });
    await updateWorkerState(project, (s) => {
      const now = new Date().toISOString();
      const stats = s.stats[task.id] ??= { taskId: task.id, title: task.title, models: [], mode: scout ? "scout" : "worktree", startedAt: now, finishedAt: null, durationMs: 0, costUsd: 0, rounds: 0, outcome: null, counted: [] };
      for (const e of entries) if (!stats.models.includes(e.model)) stats.models.push(e.model);
      if (raceId) s.races[raceId] = { id: raceId, taskId: task.id, entries, winner: null, createdAt: now };
    });
    const brief = [`Task: ${task.title}\nTask ID: ${task.id}`, args.brief ?? task.body, note?.brief].filter(Boolean).join("\n\n");
    for (const live of started) {
      attachWorker(live);
      await appendWorkLog(project, `[worker] started${scout ? " (scout)" : ""}${raceId ? ` (race · ${live.meta.model})` : ""}: ${task.title} · /w/${live.meta.workspaceId}/s/${live.id}`);
      await sendBrief(live, brief);
    }
    return { taskId: task.id, sessionId: first.id, workspaceId: first.meta.workspaceId, ...(scout ? { mode: "scout" as const } : {}), ...(raceId ? { raceId, race: entries } : {}) };
  } catch (error) {
    for (const live of started) closeSession(live.id);
    await patchTask(task.id, { status: "blocked" });
    await appendWorkLog(project, `[worker] blocked: ${task.title} · ${String(error)}`);
    throw error;
  }
}

const g2 = globalThis as typeof globalThis & { __thunkDrainTimers?: Map<string, ReturnType<typeof setTimeout>> };
const drainTimers = g2.__thunkDrainTimers ??= new Map();
/** Coalesce drains: a burst of finishes or task changes starts queued work once. */
export function scheduleDrain(projectId: string, delayMs = 1000) {
  if (drainTimers.has(projectId)) return;
  const timer = setTimeout(() => {
    drainTimers.delete(projectId);
    void drainQueue(projectId).catch((err) => console.error("[thunk] worker queue drain failed", err));
  }, delayMs);
  timer.unref?.();
  drainTimers.set(projectId, timer);
}

async function tellChief(chiefSessionId: string | null, content: string) {
  if (!chiefSessionId) return;
  const chiefId = await currentChiefId(chiefSessionId);
  const chief = chiefId ? await resumeSession(chiefId).catch(() => null) : null;
  if (chief) pushUserMessage(chief, content);
}

/** Start queued tasks in order while slots are free and their dependencies are done. Returns the task ids started. */
export async function drainQueue(projectId: string) {
  const project = await getProject(projectId);
  if (!project) return [];
  return withFileLock(`delegate:${projectId}`, async () => {
    const startedIds: string[] = [];
    for (const item of (await readWorkerState(project)).queue) {
      const dequeue = () => updateWorkerState(project, (s) => { s.queue = s.queue.filter((q) => q.taskId !== item.taskId); });
      const task = await getTask(item.taskId);
      if (!task || ["done", "cancelled"].includes(task.status)) { await dequeue(); continue; }
      const deps = await dependencyState(projectId, item.dependsOn);
      if (deps.failed.length) {
        await dequeue();
        await patchTask(task.id, { status: "blocked" });
        await appendWorkLog(project, `[worker] blocked: ${task.title} · a dependency was cancelled (${deps.failed.join(", ")})`);
        await tellChief(item.chiefSessionId, `<worker_queue task="${task.id}" status="blocked">Queued task "${task.title}" will not start: dependency ${deps.failed.join(", ")} was cancelled or removed. Re-delegate it or cancel it.</worker_queue>`);
        continue;
      }
      if (deps.waiting.length) continue;
      // Keep order among ready tasks: stop at the first that does not fit.
      if (MAX_WORKERS_PER_PROJECT - activeWorkers(projectId) < (item.input.race?.length ?? 1)) break;
      await dequeue();
      const chiefId = item.chiefSessionId ? await currentChiefId(item.chiefSessionId) : null;
      try {
        const note = item.input.noteId ? await noteBrief(project, item.input.noteId).catch(() => null) : null;
        await launch(project, task, item.input, chiefId, note);
        startedIds.push(task.id);
      } catch (err) {
        await tellChief(chiefId, `<worker_queue task="${task.id}" status="blocked">Queued task "${task.title}" failed to start: ${(err as Error).message}</worker_queue>`);
      }
    }
    return startedIds;
  });
}

export async function workersStatus(projectId: string, withDiff = false) {
  const [tasks, sessions] = await Promise.all([listTasks({ projectId }), listSessions({ projectId, limit: 10_000 })]);
  const project = await getProject(projectId);
  const state = project ? await readWorkerState(project) : null;
  const rows = await Promise.all(tasks.filter((t) => t.sessionId).map(async (task) => {
    const session = sessions.find((s) => s.id === task.sessionId);
    if (session?.origin?.kind !== "worker") return null;
    const live = getSession(session.id);
    const ctx = live?.ctx ?? await getWorkspaceContext(session.workspaceId);
    const report = ctx ? await savedReport(ctx.project, session.id) : null;
    const scout = Boolean(session.origin.scout);
    const race = session.origin.raceId ? state?.races[session.origin.raceId] : undefined;
    return { task, sessionId: session.id, workspaceId: session.workspaceId, mode: scout ? "scout" as const : "worktree" as const,
      state: session.live ? session.status : "closed", waitingOn: session.live ? session.waitingOn ?? null : null, pendingPrompts: live?.pending.size ?? 0,
      branch: scout ? null : ctx?.workspace.branch ?? null, diffStat: withDiff && ctx && !scout ? (await collectReport({ ...ctx, markdown: "" })).diffStat : null,
      lastSummary: report?.content ?? null, finishedAt: report?.createdAt ?? null, stats: state?.stats[task.id] ? { ...state.stats[task.id], counted: undefined } : null,
      race: race ? { raceId: race.id, winner: race.winner, entries: await Promise.all(race.entries.map(async (e) => ({ ...e, finished: Boolean(ctx && await savedReport(ctx.project, e.sessionId)) }))) } : null,
      overlaps: [] as { taskId: string; title: string; paths: string[] }[] };
  })).then((r) => r.filter((row) => row !== null));
  if (withDiff) {
    const overlaps = await workerOverlaps(rows.filter((r) => r.mode === "worktree" && !["done", "cancelled"].includes(r.task.status)).map((r) => ({ taskId: r.task.id, title: r.task.title, workspaceId: r.workspaceId })));
    for (const row of rows) row.overlaps = overlaps.get(row.task.id) ?? [];
  }
  const queued = (state?.queue ?? []).map((q, i) => ({ taskId: q.taskId, title: tasks.find((t) => t.id === q.taskId)?.title ?? q.taskId, position: i + 1, dependsOn: q.dependsOn, queuedAt: q.queuedAt, race: q.input.race ?? null, mode: q.input.mode ?? "worktree" }));
  return { workers: rows, queued };
}

/** Cost, duration and rounds per task, and the same summarized per model. */
export async function workersHistory(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const stats = Object.values((await readWorkerState(project)).stats);
  return { byModel: summarizeStats(stats), recent: stats.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20).map(({ counted, ...s }) => (void counted, s)) };
}

/** Accept one racer: it owns the task from now on; the others stop and their workspaces are archived (branches kept). */
export async function pickRaceWinner(projectId: string, taskId: string, sessionId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const race = Object.values((await readWorkerState(project)).races).find((r) => r.taskId === taskId && r.entries.some((e) => e.sessionId === sessionId));
  if (!race) throw new Error("That session is not racing on this task");
  if (race.winner) throw new Error("This race already has a winner");
  const winner = race.entries.find((e) => e.sessionId === sessionId)!;
  await updateWorkerState(project, (s) => { s.races[race.id].winner = sessionId; });
  await patchTask(taskId, { sessionId, workspaceId: winner.workspaceId });
  const { archiveWorkspace } = await import("@/lib/projects/archive");
  for (const loser of race.entries.filter((e) => e.sessionId !== sessionId)) {
    closeSession(loser.sessionId);
    await archiveWorkspace(loser.workspaceId).catch((err) => console.error("[thunk] race loser archive failed", err));
  }
  const task = await getTask(taskId);
  await appendWorkLog(project, `[chief] race winner: ${task?.title ?? taskId} · ${winner.model} (${sessionId})`);
  scheduleDrain(projectId, 0);
  return { taskId, winner, archived: race.entries.filter((e) => e.sessionId !== sessionId).map((e) => e.workspaceId) };
}

export async function ownedWorker(projectId: string, taskId: string, sessionId?: string) {
  const task = await getTask(taskId);
  if (!task || task.projectId !== projectId || !task.sessionId) throw new Error("Worker task not found in this project");
  // A racer other than the task's current owner is addressed by its session id.
  const session = (await listSessions({ projectId, limit: 10_000 })).find((s) => s.id === (sessionId ?? task.sessionId));
  if (session?.origin?.kind !== "worker" || session.origin.taskId !== task.id) throw new Error("Task is not owned by a worker");
  return { task, session };
}
export async function messageWorker(projectId: string, taskId: string, content: string, sessionId?: string) {
  const { task, session } = await ownedWorker(projectId, taskId, sessionId);
  const live = await resumeSession(session.id);
  if (!live) throw new Error("Worker session not found");
  attachWorker(live);
  await patchTask(task.id, { status: "in_progress" });
  pushUserMessage(live, content);
}
export async function stopWorker(projectId: string, taskId: string, reason: string) {
  const project = await getProject(projectId);
  const dequeued = project && await updateWorkerState(project, (s) => {
    const before = s.queue.length;
    s.queue = s.queue.filter((q) => q.taskId !== taskId);
    return s.queue.length < before;
  });
  if (dequeued) {
    const task = await patchTask(taskId, { status: "cancelled" });
    await appendWorkLog(project, `[chief] cancelled (queued): ${task.title} · ${reason}`);
    scheduleDrain(projectId);
    return;
  }
  const { task, session } = await ownedWorker(projectId, taskId);
  const race = session.origin?.kind === "worker" && session.origin.raceId && project ? (await readWorkerState(project)).races[session.origin.raceId] : null;
  for (const id of race && !race.winner ? race.entries.map((e) => e.sessionId) : [session.id]) closeSession(id);
  await patchTask(task.id, { status: "cancelled" });
  if (project) await appendWorkLog(project, `[chief] cancelled: ${task.title} · ${reason}`);
  scheduleDrain(projectId);
}

async function finishWorker(meta: Pick<SessionMeta, "id" | "origin" | "workspaceId" | "projectId">, result: WorkerResult, seq: number) {
  return withFileLock(`worker-finish:${meta.id}`, async () => {
    if (meta.origin?.kind !== "worker") return;
    const origin = meta.origin;
    const ctx = await getWorkspaceContext(meta.workspaceId);
    if (!ctx) return;
    const previous = await savedReport(ctx.project, meta.id);
    if (previous && previous.seq >= seq) { enqueue(reportFile(ctx.project, meta.id), previous); return; }
    // A scout runs in the main checkout: its diff is the person's own work, not the scout's.
    const report = await collectReport({ ...ctx, workspace: origin.scout ? null : ctx.workspace, markdown: result.markdown });
    const needsPerson = /^needs_person:[ \t]*(.*)$/im.exec(result.markdown)?.[1]?.trim().replace(/^(none|false|no|n\/a)\.?$/i, "");
    const status = result.status === "cancelled" ? "cancelled" : result.status === "failed" || report.outcome === "failed" ? "failed" : report.outcome === "blocked" || needsPerson ? "blocked" : "done";
    const task = await getTask(origin.taskId);
    const state = await readWorkerState(ctx.project);
    const race = origin.raceId ? state.races[origin.raceId] : undefined;
    // Racers leave the task alone until one is picked; the winner then owns it like any worker.
    const ownsTask = !race || race.winner === meta.id;
    const newerTurn = getSession(meta.id)?.events.some((e) => e.seq > seq && (e.type === "user_message" || e.type === "message_dequeued"));
    if (ownsTask && !newerTurn && task?.sessionId === meta.id && task.status !== "cancelled") await patchTask(task.id, { status: status === "cancelled" ? "cancelled" : status === "done" ? (origin.chiefSessionId ? "in_progress" : "done") : "blocked" });
    const stats = await updateWorkerState(ctx.project, (s) => {
      const row = s.stats[origin.taskId];
      if (!row) return null;
      const key = `${meta.id}:${seq}`;
      if (!row.counted.includes(key)) {
        row.counted.push(key);
        row.costUsd += result.costUsd || 0;
        if (ownsTask) row.rounds += 1;
        row.outcome = status;
        row.finishedAt = new Date().toISOString();
        row.durationMs = Date.parse(row.finishedAt) - Date.parse(row.startedAt);
      }
      return { ...row };
    });
    const overlaps = origin.scout ? [] : (await workerOverlaps(await openWorkerWorkspaces(meta.projectId))).get(origin.taskId) ?? [];
    const lines = [
      report.summary, result.error ?? "", needsPerson ? `Needs person: ${needsPerson}` : "",
      origin.scout ? "Mode: scout (read-only, no branch)" : `Branch: ${ctx.workspace.branch ?? "none"}\nDiff: ${JSON.stringify(report.diffStat)}`,
      race ? `Race: ${race.id} · model ${getSession(meta.id)?.meta.model ?? "unknown"} · ${race.entries.length} racers${race.winner ? ` · winner ${race.winner}` : " · pick one with workers_pick"}` : "",
      stats ? `Cost: $${(result.costUsd || 0).toFixed(4)} this round · $${stats.costUsd.toFixed(4)} for the task over ${stats.rounds} round${stats.rounds === 1 ? "" : "s"}` : "",
      overlaps.length ? `Overlaps: ${overlaps.map((o) => `${o.title} (${o.taskId}) on ${o.paths.slice(0, 5).join(", ")}${o.paths.length > 5 ? ` +${o.paths.length - 5}` : ""}`).join("; ")}` : "",
      `Workspace: ${sessionPath(ctx.project, ctx.workspace, meta.id)}`,
    ];
    const content = `<worker_report task="${origin.taskId}" session="${meta.id}" seq="${seq}" status="${status}"${race ? ` race="${race.id}"` : ""}>\n${lines.filter(Boolean).join("\n")}\n</worker_report>`;
    await notify({ projectId: meta.projectId, workspaceId: meta.workspaceId, sessionId: meta.id, kind: "worker_report", urgency: "info", subjectKey: `worker:${meta.id}:report:${seq}`, title: `Worker · ${task?.title ?? origin.taskId} · ${status}`, detail: content, href: sessionPath(ctx.project, ctx.workspace, meta.id) });
    await appendWorkLog(ctx.project, `[worker] ${status}: ${task?.title ?? origin.taskId} · ${report.summary}`);
    await queueReport(ctx.project, meta, seq, content);
    scheduleDrain(meta.projectId);
  });
}

/** Worktree workers whose tasks are still open, for overlap checks. */
async function openWorkerWorkspaces(projectId: string) {
  const tasks = await listTasks({ projectId });
  const sessions = await listSessions({ projectId, limit: 10_000 });
  return tasks.filter((t) => t.sessionId && ["open", "in_progress", "blocked"].includes(t.status)).flatMap((t) => {
    const session = sessions.find((s) => s.id === t.sessionId);
    return session?.origin?.kind === "worker" && !session.origin.scout ? [{ taskId: t.id, title: t.title, workspaceId: session.workspaceId }] : [];
  });
}

export function attachWorker(live: LiveSession) {
  if (!["worker", "chief"].includes(live.meta.origin?.kind ?? "") || watched.has(live)) return;
  watched.add(live);
  subscribe(live, (e) => {
    const decision = e.type === "question_resolved" ? e.answers && JSON.stringify(e.answers)
      : e.type === "permission_resolved" || e.type === "plan_resolved" ? `${e.type}: ${e.decision}` : null;
    if (decision) void appendWorkLog(live.ctx.project, `[you] decision: ${decision}`).catch((err) => console.error("[thunk] work log failed", err));
  });
  if (live.meta.origin?.kind !== "worker") return;
  let cancelWatch: (() => void) | undefined;
  const arm = () => {
    cancelWatch?.();
    cancelWatch = watchWorker(live, 60, {
      waitForQueue: true,
      pauseWhileAwaiting: true,
      finish: async (result) => {
        cancelWatch = undefined;
        await finishWorker(live.meta, result, live.seq);
      },
      status: async (status) => {
        const origin = live.meta.origin;
        if (origin?.kind !== "worker") return;
        // The chief owns these; it escalates (and logs) if the person is needed.
        if (status === "needs_attention" && [...live.pending.values()].every((p) => p.routedTo === "chief")) return;
        if (status === "needs_attention") {
          await appendWorkLog(live.ctx.project, `[worker] blocked: ${live.meta.title} · waiting for you`);
          if (origin.chiefSessionId) {
            const chiefId = await currentChiefId(origin.chiefSessionId);
            const chief = chiefId ? await resumeSession(chiefId) : null;
            if (chief) pushUserMessage(chief, `<worker_waiting task="${origin.taskId}">Waiting for the person in /w/${live.meta.workspaceId}/s/${live.id}</worker_waiting>`);
          }
        }
      },
    });
  };
  subscribe(live, (e) => {
    if ((e.type === "user_message" && !e.queued) || e.type === "message_dequeued") arm();
  });
  // Not "starting": every create and resume passes through it, including a finished worker reopened with no new turn.
  if (["running", "awaiting"].includes(live.meta.status)) arm();
}

export async function recoverWorkers() {
  onSessionCreated(attachWorker);
  ensureWorkerHousekeeping();
  for (const live of listLiveSessions()) attachWorker(live);
  const sessions = await listSessions({ limit: 100_000 });
  for (const session of sessions) {
    if (session.origin?.kind !== "worker") continue;
    try {
      const project = await getProject(session.projectId);
      if (!project) continue;
      const saved = await savedReport(project, session.id);
      for (const report of await savedReports(project, session.id)) enqueue(reportFile(project, session.id), report);
      const events = getSession(session.id)?.events ?? await loadEvents(session.id);
      const pending = new Set<string>();
      for (const event of events) {
        if (event.type === "user_message" && event.queued) pending.add(`message:${event.messageId}`);
        if (event.type === "message_dequeued") pending.delete(`message:${event.messageId}`);
        if (event.type === "permission_request" || event.type === "ask_question" || event.type === "plan_proposed") pending.add(event.requestId);
        if (event.type === "permission_resolved" || event.type === "question_resolved" || event.type === "plan_resolved") pending.delete(event.requestId);
      }
      const result = events.findLast((e) => e.type === "result");
      const latestInput = events.findLast((e) => e.type === "user_message" || e.type === "message_dequeued" || e.type === "turn_start");
      if (session.live && ["running", "awaiting", "starting"].includes(session.status)) continue;
      if (saved && (!latestInput || latestInput.seq <= saved.seq)) continue;
      if (result && pending.size === 0 && (!latestInput || latestInput.seq < result.seq)) {
        const prose = events.findLast((e) => e.type === "turn_complete" && e.seq < result.seq);
        await finishWorker(session, { status: result.isError ? "failed" : "succeeded", error: null, markdown: prose?.type === "turn_complete" ? prose.markdown : "", costUsd: result.costUsd, sessionId: session.id }, result.seq);
      } else if (!session.live && (!saved || latestInput && latestInput.seq > saved.seq)) {
        await finishWorker(session, { status: "failed", error: "Worker interrupted by server restart; inspect its workspace and message it to continue.", markdown: "", costUsd: 0, sessionId: session.id }, events.at(-1)?.seq ?? 0);
      }
    } catch (err) { console.error("[thunk] worker recovery failed", session.id, err); }
  }
}

/**
 * Start queued work when a task changes (a dependency may now be done), and archive finished
 * worker workspaces now and then. Replaces the previous subscription and timer, so HMR does not stack them.
 */
export function ensureWorkerHousekeeping() {
  const previous = g.__thunkWorkerHousekeeping;
  if (previous) { previous.unsubscribe(); clearInterval(previous.timer); }
  const unsubscribe = subscribeTasks((e) => { if (e.kind === "changed") scheduleDrain(e.projectId); });
  const timer = setInterval(() => void import("./cleanup").then((m) => m.cleanupWorkerWorkspaces()).catch((err) => console.error("[thunk] worker cleanup failed", err)), 10 * 60_000);
  timer.unref?.();
  g.__thunkWorkerHousekeeping = { unsubscribe, timer };
  void listProjects().then((projects) => { for (const p of projects) scheduleDrain(p.id, 0); }).catch((err) => console.error("[thunk] worker queue recovery failed", err));
}
