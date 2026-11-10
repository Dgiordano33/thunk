import "server-only";
import type { z } from "zod";
import { closeSession, getSession, listSessions, listLiveSessions, onSessionCreated, resumeSession, pushUserMessage, subscribe, type LiveSession } from "@/lib/agent";
import { createWorkspace, ensureMainWorkspace, getWorkspaceContext } from "@/lib/projects";
import { getProject } from "@/lib/supabase/repo/projects";
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
import { DelegateSchema } from "./schema";
const g = globalThis as typeof globalThis & { __thunkWorkerWatchers?: WeakSet<LiveSession> };
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

export async function delegate(projectId: string, chiefSessionId: string | null, input: z.infer<typeof DelegateSchema>) {
  const args = DelegateSchema.parse(input);
  return withFileLock(`delegate:${projectId}`, async () => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Project not found");
    if (chiefSessionId) {
      const chief = getSession(chiefSessionId);
      if (chief?.meta.projectId !== projectId || chief.meta.origin?.kind !== "chief") throw new Error("Only this project's chief can delegate");
    }
    if (listLiveSessions().filter((s) => s.meta.projectId === projectId && s.meta.origin?.kind === "worker" && ["starting", "running", "awaiting"].includes(s.meta.status)).length >= MAX_WORKERS_PER_PROJECT)
      throw new Error("Four workers are active; wait for a report before delegating again.");
    if (args.repoIds?.some((id) => !project.repos.some((r) => r.id === id))) throw new Error("Repository does not belong to project");
    const selected = project.repos.filter((r) => args.repoIds ? args.repoIds.includes(r.id) : r.kind === "repo");
    if (!selected.length || selected.some((r) => r.kind !== "repo")) throw new Error("Delegation needs a Git repository for an isolated worktree");
    let task = args.taskId ? await getTask(args.taskId) : null;
    if (args.taskId && (!task || task.projectId !== projectId)) throw new Error("Task not found in this project");
    const owner = task?.sessionId && getSession(task.sessionId);
    if (owner && owner.id !== chiefSessionId && ["starting", "running", "awaiting"].includes(owner.meta.status)) throw new Error("Task already has an active session");
    const noteId = args.noteId ?? task?.noteId;
    const note = noteId ? await noteBrief(project, noteId) : null;
    if (!task) task = await createTask({ projectId, title: args.title ?? note?.note.title.slice(0, 200) ?? "Delegated task", body: args.brief ?? null, noteId }, { createdBy: chiefSessionId ? "agent" : "user", createdInSessionId: chiefSessionId });
    await appendWorkLog(project, `[chief] queued: ${task.title} (${task.id})`);
    let live: LiveSession | null = null;
    try {
      const workspace = await createWorkspace({ projectId, name: `${routineSlug(task.title)}-${crypto.randomUUID().slice(0, 8)}`, repoIds: selected.map((r) => r.id), worktree: true, setup: "await" });
      live = await startWorkerSession({ workspaceId: workspace.id, title: task.title, model: args.model, permissionMode: args.permissionMode ?? "default", origin: { kind: "worker", chiefSessionId, taskId: task.id } });
      await patchTask(task.id, { workspaceId: workspace.id, sessionId: live.id, status: "in_progress", ...(noteId ? { noteId } : {}) });
      attachWorker(live);
      await appendWorkLog(project, `[worker] started: ${task.title} · /w/${workspace.id}/s/${live.id}`);
      await sendBrief(live, [`Task: ${task.title}\nTask ID: ${task.id}`, args.brief ?? task.body, note?.brief].filter(Boolean).join("\n\n"));
      return { taskId: task.id, sessionId: live.id, workspaceId: workspace.id };
    } catch (error) {
      if (live) closeSession(live.id);
      await patchTask(task.id, { status: "blocked" });
      await appendWorkLog(project, `[worker] blocked: ${task.title} · ${String(error)}`);
      throw error;
    }
  });
}

export async function workersStatus(projectId: string, withDiff = false) {
  const [tasks, sessions] = await Promise.all([listTasks({ projectId }), listSessions({ projectId, limit: 10_000 })]);
  return Promise.all(tasks.filter((t) => t.sessionId).map(async (task) => {
    const session = sessions.find((s) => s.id === task.sessionId);
    if (session?.origin?.kind !== "worker") return null;
    const live = getSession(session.id);
    const ctx = live?.ctx ?? await getWorkspaceContext(session.workspaceId);
    const project = ctx?.project;
    const report = project ? await savedReport(project, session.id) : null;
    return { task, sessionId: session.id, workspaceId: session.workspaceId, state: session.live ? session.status : "closed", pendingPrompts: live?.pending.size ?? 0,
      branch: ctx?.workspace.branch ?? null, diffStat: withDiff && ctx ? (await collectReport({ ...ctx, markdown: "" })).diffStat : null, lastSummary: report?.content ?? null, finishedAt: report?.createdAt ?? null };
  })).then((rows) => rows.filter((r) => r !== null));
}

export async function ownedWorker(projectId: string, taskId: string) {
  const task = await getTask(taskId);
  if (!task || task.projectId !== projectId || !task.sessionId) throw new Error("Worker task not found in this project");
  const session = (await listSessions({ projectId, limit: 10_000 })).find((s) => s.id === task.sessionId);
  if (session?.origin?.kind !== "worker" || session.origin.taskId !== task.id) throw new Error("Task is not owned by a worker");
  return { task, session };
}
export async function messageWorker(projectId: string, taskId: string, content: string) {
  const { task, session } = await ownedWorker(projectId, taskId);
  const live = await resumeSession(session.id);
  if (!live) throw new Error("Worker session not found");
  attachWorker(live);
  await patchTask(task.id, { status: "in_progress" });
  pushUserMessage(live, content);
}
export async function stopWorker(projectId: string, taskId: string, reason: string) {
  const { task, session } = await ownedWorker(projectId, taskId);
  closeSession(session.id);
  await patchTask(task.id, { status: "cancelled" });
  const project = await getProject(projectId);
  if (project) await appendWorkLog(project, `[chief] cancelled: ${task.title} · ${reason}`);
}

async function finishWorker(meta: Pick<SessionMeta, "id" | "origin" | "workspaceId" | "projectId">, result: WorkerResult, seq: number) {
  return withFileLock(`worker-finish:${meta.id}`, async () => {
    if (meta.origin?.kind !== "worker") return;
    const ctx = await getWorkspaceContext(meta.workspaceId);
    if (!ctx) return;
    const previous = await savedReport(ctx.project, meta.id);
    if (previous && previous.seq >= seq) { enqueue(reportFile(ctx.project, meta.id), previous); return; }
    const report = await collectReport({ ...ctx, markdown: result.markdown });
    const needsPerson = /^needs_person:[ \t]*(.*)$/im.exec(result.markdown)?.[1]?.trim().replace(/^(none|false|no|n\/a)\.?$/i, "");
    const status = result.status === "cancelled" ? "cancelled" : result.status === "failed" || report.outcome === "failed" ? "failed" : report.outcome === "blocked" || needsPerson ? "blocked" : "done";
    const task = await getTask(meta.origin.taskId);
    const newerTurn = getSession(meta.id)?.events.some((e) => e.seq > seq && (e.type === "user_message" || e.type === "message_dequeued"));
    if (!newerTurn && task?.sessionId === meta.id && task.status !== "cancelled") await patchTask(task.id, { status: status === "cancelled" ? "cancelled" : status === "done" ? (meta.origin.chiefSessionId ? "in_progress" : "done") : "blocked" });
    const content = `<worker_report task="${meta.origin.taskId}" session="${meta.id}" seq="${seq}" status="${status}">\n${report.summary}\n${result.error ?? ""}\n${needsPerson ? `Needs person: ${needsPerson}` : ""}\nBranch: ${ctx.workspace.branch ?? "none"}\nDiff: ${JSON.stringify(report.diffStat)}\nWorkspace: /w/${meta.workspaceId}/s/${meta.id}\n</worker_report>`;
    await notify({ projectId: meta.projectId, workspaceId: meta.workspaceId, sessionId: meta.id, kind: "worker_report", urgency: "info", subjectKey: `worker:${meta.id}:report:${seq}`, title: `Worker · ${task?.title ?? meta.origin.taskId} · ${status}`, detail: content, href: `/w/${meta.workspaceId}/s/${meta.id}` });
    await appendWorkLog(ctx.project, `[worker] ${status}: ${task?.title ?? meta.origin.taskId} · ${report.summary}`);
    await queueReport(ctx.project, meta, seq, content);
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
