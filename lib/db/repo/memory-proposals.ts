import "server-only";
import { db } from "../server";
import type { MemoryItemDecision, MemoryKind, MemoryOp, MemoryProposal, MemoryProposalItem, MemoryProposalOrigin, MemoryProposalStatus, MemorySource } from "@/lib/memory/types";

const g = globalThis as typeof globalThis & { __thunkMemProposals?: Map<string, MemoryProposal> };
const mem = (g.__thunkMemProposals ??= new Map<string, MemoryProposal>());

type ProposalRow = {
  id: string; project_id: string; workspace_id: string | null; session_id: string | null; run_id: string | null; origin: string; status: string;
  base_hash: string; summary: string | null; created_at: string; updated_at: string; resolved_at: string | null;
};
type ItemRow = {
  id: string; proposal_id: string; position: number; op: string; target: string | null; text: string | null; kind: string | null; sources: unknown;
  reason: string; review_after: string | null; decision: string; edited_text: string | null; flag: string | null;
};

/** review_after as text: a date column would parse to a local-midnight Date and could shift a day. */
const ITEMS = "select id, proposal_id, position, op, target, text, kind, sources, reason, review_after::text as review_after, decision, edited_text, flag from memory_proposal_items";
const dateOnly = (value: string | null) => value ? value.slice(0, 10) : null;
function itemFrom(r: ItemRow): MemoryProposalItem {
  return { id: r.id, position: r.position, op: r.op as MemoryOp, target: r.target, text: r.text, kind: r.kind as MemoryKind | null,
    sources: (typeof r.sources === "string" ? JSON.parse(r.sources) : r.sources ?? []) as MemorySource[], reason: r.reason,
    reviewAfter: dateOnly(r.review_after), decision: r.decision as MemoryItemDecision, editedText: r.edited_text, flag: r.flag };
}
function proposalFrom(r: ProposalRow, items: MemoryProposalItem[]): MemoryProposal {
  return { id: r.id, projectId: r.project_id, workspaceId: r.workspace_id, sessionId: r.session_id, runId: r.run_id, origin: r.origin as MemoryProposalOrigin,
    status: r.status as MemoryProposalStatus, baseHash: r.base_hash, summary: r.summary, createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at, items };
}

export type NewMemoryProposal = Pick<MemoryProposal, "projectId" | "origin" | "baseHash"> & Partial<Pick<MemoryProposal, "workspaceId" | "sessionId" | "runId" | "summary" | "status">> & {
  items: Pick<MemoryProposalItem, "op" | "target" | "text" | "kind" | "sources" | "reason" | "reviewAfter">[];
};

export async function insertMemoryProposal(input: NewMemoryProposal): Promise<MemoryProposal> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const status = input.status ?? "open";
  const items: MemoryProposalItem[] = input.items.map((item, position) => ({ ...item, id: crypto.randomUUID(), position, decision: "pending", editedText: null, flag: null }));
  const client = db();
  if (!client) {
    const row: MemoryProposal = { id, projectId: input.projectId, workspaceId: input.workspaceId ?? null, sessionId: input.sessionId ?? null, runId: input.runId ?? null,
      origin: input.origin, status, baseHash: input.baseHash, summary: input.summary ?? null, createdAt: now, updatedAt: now, resolvedAt: status === "open" ? null : now, items };
    mem.set(id, row);
    return structuredClone(row);
  }
  await client.query(
    `insert into memory_proposals (id, project_id, workspace_id, session_id, run_id, origin, status, base_hash, summary, resolved_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, input.projectId, input.workspaceId ?? null, input.sessionId ?? null, input.runId ?? null, input.origin, status, input.baseHash, input.summary ?? null, status === "open" ? null : now]);
  for (const item of items) {
    await client.query(
      `insert into memory_proposal_items (id, proposal_id, position, op, target, text, kind, sources, reason, review_after) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [item.id, id, item.position, item.op, item.target, item.text, item.kind, JSON.stringify(item.sources), item.reason, item.reviewAfter]);
  }
  return (await getMemoryProposal(id))!;
}

export async function getMemoryProposal(id: string): Promise<MemoryProposal | null> {
  const client = db();
  if (!client) { const row = mem.get(id); return row ? structuredClone(row) : null; }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await client.query<ProposalRow>("select * from memory_proposals where id = $1", [id]);
  if (!row) return null;
  const items = await client.query<ItemRow>(`${ITEMS} where proposal_id = $1 order by position`, [id]);
  return proposalFrom(row, items.map(itemFrom));
}

export async function listMemoryProposals(match: { projectId?: string; sessionId?: string; runId?: string; status?: MemoryProposalStatus } = {}): Promise<MemoryProposal[]> {
  const client = db();
  if (!client) return [...mem.values()].filter((p) => (!match.projectId || p.projectId === match.projectId) && (!match.sessionId || p.sessionId === match.sessionId)
    && (!match.runId || p.runId === match.runId) && (!match.status || p.status === match.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => structuredClone(p));
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of [["project_id", match.projectId], ["session_id", match.sessionId], ["run_id", match.runId], ["status", match.status]] as const) {
    if (!value) continue;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  }
  const rows = await client.query<ProposalRow>(`select * from memory_proposals${where.length ? ` where ${where.join(" and ")}` : ""} order by created_at desc limit 100`, params);
  const items = rows.length ? await client.query<ItemRow>(`${ITEMS} where proposal_id = any($1::uuid[]) order by position`, [rows.map((r) => r.id)]) : [];
  return rows.map((r) => proposalFrom(r, items.filter((i) => i.proposal_id === r.id).map(itemFrom)));
}

export type ItemPatch = { id: string } & Partial<Pick<MemoryProposalItem, "decision" | "editedText" | "flag">>;
export async function updateMemoryProposal(id: string, patch: Partial<Pick<MemoryProposal, "status" | "baseHash">>, items: ItemPatch[] = []): Promise<MemoryProposal | null> {
  const now = new Date().toISOString();
  const resolvedAt = patch.status && patch.status !== "open" ? now : undefined;
  const client = db();
  if (!client) {
    const row = mem.get(id);
    if (!row) return null;
    const next: MemoryProposal = { ...row, ...patch, updatedAt: now, ...(resolvedAt ? { resolvedAt } : {}),
      items: row.items.map((item) => { const p = items.find((i) => i.id === item.id); return p ? { ...item, ...p, id: item.id } : item; }) };
    mem.set(id, next);
    return structuredClone(next);
  }
  await client.query(
    `update memory_proposals set status = coalesce($2, status), base_hash = coalesce($3, base_hash), resolved_at = coalesce($4, resolved_at), updated_at = now() where id = $1`,
    [id, patch.status ?? null, patch.baseHash ?? null, resolvedAt ?? null]);
  for (const item of items) {
    const sets: string[] = [];
    const params: unknown[] = [item.id, id];
    if (item.decision !== undefined) { params.push(item.decision); sets.push(`decision = $${params.length}`); }
    if (item.editedText !== undefined) { params.push(item.editedText); sets.push(`edited_text = $${params.length}`); }
    if (item.flag !== undefined) { params.push(item.flag); sets.push(`flag = $${params.length}`); }
    if (sets.length) await client.query(`update memory_proposal_items set ${sets.join(", ")} where id = $1 and proposal_id = $2`, params);
  }
  return getMemoryProposal(id);
}
