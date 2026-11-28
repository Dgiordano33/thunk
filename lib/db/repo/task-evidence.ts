import "server-only";
import type { Evidence, NewEvidence } from "@/lib/evidence/types";
import { db } from "../server";

type Row = { id: string; task_id: string; criterion_id: string | null; origin: string; type: string; status: string; detail: string; ref: string | null; commit_sha: string | null; criteria_version: number; session_id: string | null; created_at: string };
const toEvidence = (r: Row): Evidence => ({
  id: r.id, taskId: r.task_id, criterionId: r.criterion_id, origin: r.origin as Evidence["origin"], type: r.type as Evidence["type"], status: r.status as Evidence["status"],
  detail: r.detail, ref: r.ref, commitSha: r.commit_sha, criteriaVersion: r.criteria_version, sessionId: r.session_id, createdAt: r.created_at,
});
const g = globalThis as typeof globalThis & { __thunkMemEvidence?: Evidence[] };
const mem = (g.__thunkMemEvidence ??= []);

/** Append evidence rows. Rows are never edited: newer evidence supersedes older in the card. */
export async function insertEvidence(rows: NewEvidence[]): Promise<Evidence[]> {
  if (!rows.length) return [];
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const added = rows.map((r) => ({ ...r, id: crypto.randomUUID(), createdAt: r.createdAt ?? now }));
    mem.push(...added);
    // shortcut: memory mode keeps the latest 2000 rows, use a database for full history.
    if (mem.length > 2000) mem.splice(0, mem.length - 2000);
    return structuredClone(added);
  }
  const out: Evidence[] = [];
  for (const r of rows) {
    const [row] = await client.query<Row>(
      `insert into task_evidence (task_id, criterion_id, origin, type, status, detail, ref, commit_sha, criteria_version, session_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now())) returning *`,
      [r.taskId, r.criterionId, r.origin, r.type, r.status, r.detail, r.ref, r.commitSha, r.criteriaVersion, r.sessionId, r.createdAt ?? null],
    );
    out.push(toEvidence(row));
  }
  return out;
}

/** A task's evidence, newest first. */
export async function listEvidence(taskId: string): Promise<Evidence[]> {
  const client = db();
  if (!client) return structuredClone(mem.filter((e) => e.taskId === taskId).reverse());
  return (await client.query<Row>("select * from task_evidence where task_id = $1 order by created_at desc, id desc limit 500", [taskId])).map(toEvidence);
}
