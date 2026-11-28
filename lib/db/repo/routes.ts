import "server-only";
import type { RoutePlanInput, RouteStatus } from "@/lib/home/schema";
import { db, type Db } from "../server";

/** A request the top chief routed to a project chief. `ref` is written onto the note line. */
export type Route = {
  ref: string; planId: string; projectId: string; projectName: string; workspaceId: string | null;
  title: string; brief: string; noteId: string | null; status: RouteStatus | "routed"; summary: string | null;
  createdAt: string; updatedAt: string;
};
/** `refs` are the routes the plan created, in order. */
export type RoutePlan = RoutePlanInput & { id: string; status: "pending" | "approved" | "rejected"; createdAt: string; decidedAt: string | null; note: string | null; refs: string[] };

type PlanRow = { id: string; summary: string; note_id: string | null; items: RoutePlan["items"]; status: RoutePlan["status"]; created_at: string; decided_at: string | null; note: string | null; refs: string[] };
type RouteRow = { ref: string; plan_id: string; project_id: string; project_name: string; workspace_id: string | null; title: string; brief: string; note_id: string | null; status: Route["status"]; summary: string | null; created_at: string; updated_at: string };

const g = globalThis as typeof globalThis & { __thunkMemRouting?: { plans: Map<string, RoutePlan>; routes: Map<string, Route> } };
const mem = (g.__thunkMemRouting ??= { plans: new Map(), routes: new Map() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_SELECT = "select p.*, coalesce((select json_agg(r.ref order by r.created_at, r.ref) from routes r where r.plan_id = p.id), '[]'::json) as refs from route_plans p";
const toPlan = (r: PlanRow): RoutePlan => ({
  id: r.id, summary: r.summary, ...(r.note_id ? { noteId: r.note_id } : {}), items: r.items, status: r.status,
  createdAt: r.created_at, decidedAt: r.decided_at, note: r.note, refs: r.refs,
});
const toRoute = (r: RouteRow): Route => ({
  ref: r.ref, planId: r.plan_id, projectId: r.project_id, projectName: r.project_name, workspaceId: r.workspace_id, title: r.title, brief: r.brief,
  noteId: r.note_id, status: r.status, summary: r.summary, createdAt: r.created_at, updatedAt: r.updated_at,
});
const memRefs = (planId: string) => [...mem.routes.values()].filter((r) => r.planId === planId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => r.ref);

export async function insertRoutePlanRow(tx: Db, plan: Omit<RoutePlan, "refs">) {
  await tx.query(
    "insert into route_plans (id, summary, note_id, items, status, created_at, decided_at, note) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) on conflict (id) do nothing",
    [plan.id, plan.summary, plan.noteId ?? null, JSON.stringify(plan.items), plan.status, plan.createdAt, plan.decidedAt, plan.note],
  );
}

export async function insertRouteRow(tx: Db, route: Route) {
  await tx.query(
    `insert into routes (ref, plan_id, project_id, project_name, workspace_id, title, brief, note_id, status, summary, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (ref) do nothing`,
    [route.ref, route.planId, route.projectId, route.projectName, route.workspaceId, route.title, route.brief, route.noteId, route.status, route.summary, route.createdAt, route.updatedAt],
  );
}

export async function insertRoutePlan(plan: Omit<RoutePlan, "refs">) {
  const client = db();
  if (!client) { mem.plans.set(plan.id, structuredClone({ ...plan, refs: [] })); return; }
  await insertRoutePlanRow(client, plan);
}

export async function getRoutePlan(planId: string): Promise<RoutePlan | null> {
  const client = db();
  if (!client) { const plan = mem.plans.get(planId); return plan ? { ...structuredClone(plan), refs: memRefs(planId) } : null; }
  if (!UUID.test(planId)) return null;
  const [row] = await client.query<PlanRow>(`${PLAN_SELECT} where p.id = $1`, [planId]);
  return row ? toPlan(row) : null;
}

export async function listRoutePlans(status?: RoutePlan["status"]): Promise<RoutePlan[]> {
  const client = db();
  if (!client) return [...mem.plans.values()].filter((p) => !status || p.status === status).map((p) => ({ ...structuredClone(p), refs: memRefs(p.id) }));
  return (await client.query<PlanRow>(`${PLAN_SELECT} where $1::text is null or p.status = $1 order by p.created_at`, [status ?? null])).map(toPlan);
}

/** Approve or reject a pending plan. Null when it was already decided. */
export async function decideRoutePlanRow(planId: string, status: "approved" | "rejected", note: string | null): Promise<RoutePlan | null> {
  const decidedAt = new Date().toISOString();
  const client = db();
  if (!client) {
    const plan = mem.plans.get(planId);
    if (!plan || plan.status !== "pending") return null;
    Object.assign(plan, { status, decidedAt, note });
    return getRoutePlan(planId);
  }
  const [row] = await client.query("update route_plans set status = $2, decided_at = $3, note = $4 where id = $1 and status = 'pending' returning id", [planId, status, decidedAt, note]);
  return row ? getRoutePlan(planId) : null;
}

export async function insertRoute(route: Route) {
  const client = db();
  if (!client) { mem.routes.set(route.ref, structuredClone(route)); return; }
  await insertRouteRow(client, route);
}

export async function listRoutes(): Promise<Route[]> {
  const client = db();
  if (!client) return [...mem.routes.values()].map((r) => structuredClone(r));
  return (await client.query<RouteRow>("select * from routes order by created_at")).map(toRoute);
}

/** Settle a route sent to this project. Null when no such route went there. */
export async function settleRoute(ref: string, projectId: string, status: RouteStatus, summary: string): Promise<Route | null> {
  const updatedAt = new Date().toISOString();
  const client = db();
  if (!client) {
    const route = mem.routes.get(ref);
    if (!route || route.projectId !== projectId) return null;
    Object.assign(route, { status, summary, updatedAt });
    return structuredClone(route);
  }
  const [row] = await client.query<RouteRow>(
    "update routes set status = $3, summary = $4, updated_at = $5 where ref = $1 and project_id::text = $2 returning *",
    [ref, projectId, status, summary, updatedAt],
  );
  return row ? toRoute(row) : null;
}
