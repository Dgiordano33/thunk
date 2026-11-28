import "server-only";
import { db, type Db } from "../server";

/** A worker's report for one finished turn, waiting for (or already delivered to) its chief. */
export type WorkerReport = { sessionId: string; seq: number; createdAt: string; content: string; chiefSessionId: string | null; delivered: boolean };

type Row = { session_id: string; seq: number; content: string; chief_session_id: string | null; created_at: string; delivered_at: string | null };
const toReport = (r: Row): WorkerReport => ({ sessionId: r.session_id, seq: r.seq, createdAt: r.created_at, content: r.content, chiefSessionId: r.chief_session_id, delivered: r.delivered_at !== null });

const g = globalThis as typeof globalThis & { __thunkMemWorkerReports?: Map<string, WorkerReport & { projectId: string }> };
const mem = (g.__thunkMemWorkerReports ??= new Map());
const memKey = (sessionId: string, seq: number) => `${sessionId}:${seq}`;
const strip = ({ projectId, ...report }: WorkerReport & { projectId: string }): WorkerReport => (void projectId, { ...report });

export async function insertReportRow(tx: Db, projectId: string, r: WorkerReport) {
  const [row] = await tx.query<Row>(
    `insert into worker_reports (session_id, seq, project_id, content, chief_session_id, created_at, delivered_at)
     values ($1, $2, $3, $4, $5, $6, case when $7::boolean then now() end) on conflict (session_id, seq) do nothing returning *`,
    [r.sessionId, r.seq, projectId, r.content, r.chiefSessionId, r.createdAt, r.delivered],
  );
  return row ? toReport(row) : null;
}

/** A session's reports, oldest first. */
export async function listWorkerReports(sessionId: string): Promise<WorkerReport[]> {
  const client = db();
  if (!client) return [...mem.values()].filter((r) => r.sessionId === sessionId).sort((a, b) => a.seq - b.seq).map(strip);
  return (await client.query<Row>("select * from worker_reports where session_id = $1 order by seq", [sessionId])).map(toReport);
}

/** The session's newest report, or null. */
export async function latestWorkerReport(sessionId: string): Promise<WorkerReport | null> {
  const client = db();
  if (!client) return (await listWorkerReports(sessionId)).at(-1) ?? null;
  const [row] = await client.query<Row>("select * from worker_reports where session_id = $1 order by seq desc limit 1", [sessionId]);
  return row ? toReport(row) : null;
}

/** Store a report once. A report for the same turn that already exists is returned unchanged. */
export async function saveWorkerReport(projectId: string, report: Omit<WorkerReport, "createdAt"> & { createdAt?: string }): Promise<WorkerReport> {
  const next = { ...report, createdAt: report.createdAt ?? new Date().toISOString() };
  const client = db();
  if (!client) {
    const key = memKey(report.sessionId, report.seq);
    const existing = mem.get(key);
    if (existing) return strip(existing);
    mem.set(key, { ...next, projectId });
    return { ...next };
  }
  const inserted = await insertReportRow(client, projectId, next);
  if (inserted) return inserted;
  const [row] = await client.query<Row>("select * from worker_reports where session_id = $1 and seq = $2", [report.sessionId, report.seq]);
  return toReport(row);
}

/** Mark reports as delivered to their chief. */
export async function markReportsDelivered(reports: Pick<WorkerReport, "sessionId" | "seq">[]) {
  if (!reports.length) return;
  const client = db();
  if (!client) {
    for (const r of reports) { const row = mem.get(memKey(r.sessionId, r.seq)); if (row) row.delivered = true; }
    return;
  }
  await client.query(
    `update worker_reports w set delivered_at = now() from jsonb_to_recordset($1::jsonb) as d(session_id uuid, seq integer)
     where w.session_id = d.session_id and w.seq = d.seq and w.delivered_at is null`,
    [JSON.stringify(reports.map((r) => ({ session_id: r.sessionId, seq: r.seq })))],
  );
}
