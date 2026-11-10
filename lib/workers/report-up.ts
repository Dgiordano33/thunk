import "server-only";
import path from "node:path";
import { getSession, listSessions, resumeSession, pushUserMessage } from "@/lib/agent";
import type { SessionMeta } from "@/lib/agent/types";
import type { Project } from "@/lib/projects/types";
import { projectConfigDir } from "@/lib/projects/paths";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { insertEvents } from "@/lib/supabase/repo/messages";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

type Report = { seq: number; createdAt: string; content: string; chiefSessionId: string | null; delivered: boolean };
const g = globalThis as typeof globalThis & { __thunkReportBatches?: Map<string, { reports: Map<string, { file: string; report: Report }>; timer: ReturnType<typeof setTimeout> }> };
const batches = g.__thunkReportBatches ??= new Map();
export const reportFile = (project: Project, sessionId: string) => path.join(projectConfigDir(project.dataKey), "worker-reports", `${sessionId}.json`);
export async function savedReports(project: Project, sessionId: string): Promise<Report[]> {
  const text = await readOptional(reportFile(project, sessionId));
  return text ? JSON.parse(text) : [];
}
export async function savedReport(project: Project, sessionId: string): Promise<Report | null> {
  return (await savedReports(project, sessionId)).at(-1) ?? null;
}
export async function queueReport(project: Project, session: Pick<SessionMeta, "id" | "origin">, seq: number, content: string) {
  if (session.origin?.kind !== "worker") return;
  const chiefSessionId = session.origin.chiefSessionId;
  const file = reportFile(project, session.id);
  const report = await withFileLock(file, async () => {
    const previous = await readOptional(file);
    const saved: Report[] = previous ? JSON.parse(previous) : [];
    const existing = saved.find((r) => r.seq === seq);
    if (existing) return existing;
    const next: Report = { seq, createdAt: new Date().toISOString(), content, chiefSessionId, delivered: !chiefSessionId };
    const reports = [...saved.filter((r) => !r.delivered), next].sort((a, b) => a.seq - b.seq);
    await replaceFile(file, JSON.stringify(reports), previous);
    return next;
  });
  enqueue(file, report);
}
export function enqueue(file: string, report: Report) {
  if (report.delivered || !report.chiefSessionId) return;
  const chiefId = report.chiefSessionId;
  let batch = batches.get(chiefId);
  if (!batch) {
    const timer = setTimeout(() => void flushReports(chiefId).catch((err) => console.error("[thunk] worker report delivery", err)), 20_000);
    timer.unref?.();
    batch = { reports: new Map(), timer };
    batches.set(chiefId, batch);
  }
  batch.reports.set(`${file}:${report.seq}`, { file, report });
}
/** A worker answers to its project's newest chief, so "New chief" takes over work already running. Null when the chief was deleted. */
export async function currentChiefId(chiefId: string) {
  const meta = getSession(chiefId)?.meta ?? await getSessionRow(chiefId);
  if (!meta) return null;
  return (await listSessions({ workspaceId: meta.workspaceId, limit: 10_000 })).find((s) => s.origin?.kind === "chief")?.id ?? chiefId;
}
async function markDelivered(pending: { file: string; report: Report }[]) {
  for (const { file, report } of pending) await withFileLock(file, async () => {
    const previous = await readOptional(file);
    if (previous) {
      const reports: Report[] = JSON.parse(previous);
      await replaceFile(file, JSON.stringify(reports.map((r) => r.seq === report.seq ? { ...r, delivered: true } : r)), previous);
    }
  });
}
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
    const content = pending.map(({ report }) => report.content).join("\n\n");
    // A persisted user message is the delivery receipt if we crash before clearing the outbox.
    const unsent = pending.filter(({ report }) => !live.events.some((e) => e.type === "user_message" && e.content.includes(report.content)));
    if (unsent.length) {
      const before = live.seq;
      pushUserMessage(live, unsent.length === pending.length ? content : unsent.map(({ report }) => report.content).join("\n\n"));
      await insertEvents(live.id, live.events.filter((e) => e.seq > before && e.type === "user_message"));
    }
    await markDelivered(pending);
  } catch (err) {
    for (const { file, report } of pending) enqueue(file, report);
    throw err;
  }
}
