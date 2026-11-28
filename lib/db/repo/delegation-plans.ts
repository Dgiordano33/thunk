import "server-only";
import type { DelegationPlan, PlanStatus } from "@/lib/workers/state";
import { db, type Db } from "../server";
import { transaction } from "../sql";

/** A plan as stored: the proposal, its decision, and each task with the id it was delegated as. */
export type StoredPlan = Omit<DelegationPlan, "tasks"> & { projectId: string; tasks: (DelegationPlan["tasks"][number] & { taskId: string | null })[] };

type PlanRow = { id: string; project_id: string; chief_session_id: string; relay_id: string | null; summary: string; note_id: string | null; status: string; created_at: string; decided_at: string | null; note: string | null };
type TaskRow = { plan_id: string; key: string; position: number; title: string; brief: string; model: string | null; mode: string | null; depends_on: string[]; race: string[] | null; task_id: string | null; criteria?: { id?: string; text: string; kind?: string }[] | null };

const g = globalThis as typeof globalThis & { __thunkMemPlans?: Map<string, StoredPlan> };
const mem: Map<string, StoredPlan> = (g.__thunkMemPlans ??= new Map());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = (plan: StoredPlan): StoredPlan => structuredClone(plan);

function toPlan(row: PlanRow, rows: TaskRow[]): StoredPlan {
  const tasks = rows.sort((a, b) => a.position - b.position).map((t) => ({
    key: t.key, title: t.title, brief: t.brief,
    // Absent rather than null, so the plan's tasks still parse as delegate input.
    ...(t.model ? { model: t.model } : {}), ...(t.mode ? { mode: t.mode as "worktree" | "scout" } : {}),
    ...(t.depends_on.length ? { dependsOn: t.depends_on } : {}), ...(t.race ? { race: t.race } : {}),
    ...(t.criteria?.length ? { criteria: t.criteria as NonNullable<DelegationPlan["tasks"][number]["criteria"]> } : {}),
    taskId: t.task_id,
  }));
  return {
    id: row.id, projectId: row.project_id, chiefSessionId: row.chief_session_id, status: row.status as PlanStatus,
    ...(row.relay_id ? { relayId: row.relay_id } : {}), summary: row.summary, ...(row.note_id ? { noteId: row.note_id } : {}),
    createdAt: row.created_at, decidedAt: row.decided_at, note: row.note, tasks,
    taskIds: Object.fromEntries(tasks.flatMap((t) => t.taskId ? [[t.key, t.taskId]] : [])),
  };
}

/** Insert a plan and its tasks; a plan that already exists is left alone (the import runs more than once). */
export async function insertPlanRows(tx: Db, projectId: string, plan: DelegationPlan) {
  const [inserted] = await tx.query<{ id: string }>(
    `insert into delegation_plans (id, project_id, chief_session_id, relay_id, summary, note_id, status, created_at, decided_at, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do nothing returning id`,
    [plan.id, projectId, plan.chiefSessionId, plan.relayId ?? null, plan.summary, plan.noteId ?? null, plan.status, plan.createdAt, plan.decidedAt, plan.note],
  );
  if (!inserted) return;
  for (const [position, t] of plan.tasks.entries()) {
    await tx.query(
      `insert into delegation_plan_tasks (plan_id, key, position, title, brief, model, mode, depends_on, race, task_id, criteria)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb)`,
      [plan.id, t.key, position, t.title, t.brief, t.model ?? null, t.mode ?? null, JSON.stringify(t.dependsOn ?? []), t.race ? JSON.stringify(t.race) : null, plan.taskIds[t.key] ?? null, t.criteria?.length ? JSON.stringify(t.criteria) : null],
    );
  }
}

export async function insertPlan(projectId: string, plan: DelegationPlan) {
  const client = db();
  if (!client) {
    mem.set(plan.id, clone({ ...plan, projectId, tasks: plan.tasks.map((t) => ({ ...t, taskId: plan.taskIds[t.key] ?? null })) }));
    return;
  }
  await transaction(client, (tx) => insertPlanRows(tx, projectId, plan));
}

/** A plan with its tasks, in order, and the task each was delegated as. */
export async function getDelegationPlan(planId: string): Promise<StoredPlan | null> {
  const client = db();
  if (!client) { const plan = mem.get(planId); return plan ? clone(plan) : null; }
  if (!UUID.test(planId)) return null;
  const [row] = await client.query<PlanRow>("select * from delegation_plans where id = $1", [planId]);
  if (!row) return null;
  return toPlan(row, await client.query<TaskRow>("select * from delegation_plan_tasks where plan_id = $1", [planId]));
}

/** Whether a plan made for this relay still waits for the person's decision. */
export async function hasPendingPlanForRelay(relayId: string): Promise<boolean> {
  const client = db();
  if (!client) return [...mem.values()].some((p) => p.relayId === relayId && p.status === "pending");
  if (!UUID.test(relayId)) return false;
  const [row] = await client.query<{ n: number }>("select count(*)::int as n from delegation_plans where relay_id = $1 and status = 'pending'", [relayId]);
  return (row?.n ?? 0) > 0;
}

/** Record the task a plan entry was delegated as, as soon as it starts. */
export async function setPlanTask(planId: string, key: string, taskId: string) {
  const client = db();
  if (!client) {
    const plan = mem.get(planId);
    const task = plan?.tasks.find((t) => t.key === key);
    if (task) { task.taskId = taskId; plan!.taskIds[key] = taskId; }
    return;
  }
  await client.query("update delegation_plan_tasks set task_id = $3 where plan_id = $1 and key = $2", [planId, key, taskId]);
}

/** Approve or reject a pending plan. Null when it was already decided, so two deciders cannot both win. */
export async function decidePlanRow(planId: string, status: Exclude<PlanStatus, "pending">, note: string | null): Promise<StoredPlan | null> {
  const decidedAt = new Date().toISOString();
  const client = db();
  if (!client) {
    const plan = mem.get(planId);
    if (!plan || plan.status !== "pending") return null;
    Object.assign(plan, { status, decidedAt, note });
    return clone(plan);
  }
  const [row] = await client.query<{ id: string }>(
    "update delegation_plans set status = $2, decided_at = $3, note = $4 where id = $1 and status = 'pending' returning id",
    [planId, status, decidedAt, note],
  );
  return row ? getDelegationPlan(planId) : null;
}
