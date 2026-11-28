import "server-only";
import { getSession, listSessions, resumeSession, pushUserMessage } from "@/lib/agent";
import type { SessionMeta } from "@/lib/agent/types";
import type { Project } from "@/lib/projects/types";
import { insertEvents } from "@/lib/db/repo/messages";
import { getSessionRow } from "@/lib/db/repo/sessions";
import { latestWorkerReport, listWorkerReports, markReportsDelivered, saveWorkerReport, type WorkerReport } from "@/lib/db/repo/worker-reports";

type Report = WorkerReport;
const g = globalThis as typeof globalThis & { __thunkReportBatches?: Map<string, { reports: Map<string, Report>; timer: ReturnType<typeof setTimeout> }> };
const batches = g.__thunkReportBatches ??= new Map();
/** The worker session's reports (the outbox to its chief), oldest first. */
export const savedReports = (sessionId: string): Promise<Report[]> => listWorkerReports(sessionId);
export const savedReport = (sessionId: string): Promise<Report | null> => latestWorkerReport(sessionId);
export async function queueReport(project: Project, session: Pick<SessionMeta, "id" | "origin">, seq: number, content: string, sourceVersion: WorkerReport["sourceVersion"] = null) {
  if (session.origin?.kind !== "worker") return;
  const chiefSessionId = session.origin.chiefSessionId;
  enqueue(await saveWorkerReport(project.id, { sessionId: session.id, seq, content, chiefSessionId, delivered: !chiefSessionId, sourceVersion }));
}
export function enqueue(report: Report) {
  if (report.delivered || !report.chiefSessionId) return;
  const chiefId = report.chiefSessionId;
  let batch = batches.get(chiefId);
  if (!batch) {
    const timer = setTimeout(() => void flushReports(chiefId).catch((err) => console.error("[thunk] worker report delivery", err)), 20_000);
    timer.unref?.();
    batch = { reports: new Map(), timer };
    batches.set(chiefId, batch);
  }
  batch.reports.set(`${report.sessionId}:${report.seq}`, report);
}
/** A worker answers to its project's newest chief, so "New chief" takes over work already running. Null when the chief was deleted. */
export async function currentChiefId(chiefId: string) {
  const meta = getSession(chiefId)?.meta ?? await getSessionRow(chiefId);
  if (!meta) return null;
  return (await listSessions({ projectId: meta.projectId, limit: 10_000 })).find((s) => s.origin?.kind === "chief")?.id ?? chiefId;
}
const markDelivered = (pending: Report[]) => markReportsDelivered(pending);
export async function flushReports(chiefId: string) {
  const batch = batches.get(chiefId);
  if (!batch) return;
  clearTimeout(batch.timer);
  batches.delete(chiefId);
  const pending = [...batch.reports.values()];
  try {
    const targetId = await currentChiefId(chiefId);
    const chief = targetId ? getSession(targetId) ?? await resumeSession(targetId) : null;
    const live = targetId && chief && ["closed", "error"].includes(chief.meta.status) ? await resumeSession(targetId) : chief;
    // Each report already reached the inbox through notify; retrying cannot bring a deleted chief back.
    if (!live) return await markDelivered(pending);
    const content = pending.map((report) => report.content).join("\n\n");
    // A persisted user message is the delivery receipt if we crash before clearing the outbox.
    const unsent = pending.filter((report) => !live.events.some((e) => e.type === "user_message" && e.content.includes(report.content)));
    if (unsent.length) {
      const before = live.seq;
      pushUserMessage(live, unsent.length === pending.length ? content : unsent.map((report) => report.content).join("\n\n"));
      await insertEvents(live.id, live.events.filter((e) => e.seq > before && e.type === "user_message"));
    }
    await markDelivered(pending);
  } catch (err) {
    for (const report of pending) enqueue(report);
    throw err;
  }
}
