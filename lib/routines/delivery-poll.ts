import "server-only";
import { deliveryHistories, workspaceDeliveries } from "@/lib/projects/delivery";
import type { DeliveryHistory } from "@/lib/projects/delivery-history";
import type { WorkspaceDelivery } from "@/lib/projects/delivery-types";
import { listEnabledRoutines, updateRoutine } from "@/lib/supabase/repo/routines";
import { fire } from "./runner";
import { DELIVERY_ROUTINE_EVENTS, type Routine } from "./types";

/** Select only new, still-relevant events; a new subscription quietly establishes its cursor. */
export function pendingDeliveryEvents(routine: Routine, history: DeliveryHistory, deliveries: WorkspaceDelivery[]) {
  const config = JSON.stringify([routine.events.slice().sort(), routine.targetKind, routine.targetWorkspaceId]);
  const cursor = { epoch: history.epoch, seq: history.seq, config };
  const before = routine.triggerState.delivery;
  const events = !before || before.epoch !== cursor.epoch || before.config !== config ? [] : history.events.filter((event) => {
    if (event.seq <= before.seq || !DELIVERY_ROUTINE_EVENTS.includes(event.type as never) || !routine.events.includes(event.type as never)) return false;
    const current = history.snapshots.find((s) => s.pr.number === event.pr.number && s.pr.head === event.pr.head);
    if (!current || current.state !== "OPEN") return false;
    if (event.type === "ci_failed" && !current.checks.some((c) => c.state === "fail")) return false;
    if (event.type === "review_requested" && !current.requests.length) return false;
    if (event.type === "deploy_ready" && !current.deployments.some((d) => d.state === "SUCCESS" && d.url === event.previewUrl)) return false;
    if (routine.targetKind === "ephemeral") return !event.branch.startsWith("thunk/");
    return deliveries.some((d) => d.projectId === routine.projectId && d.workspaceId === routine.targetWorkspaceId && !d.error && d.status.branch === event.branch);
  });
  return { cursor, events };
}

export async function pollDeliveryRoutines() {
  const histories = deliveryHistories();
  if (!histories.length) return;
  const routines = await listEnabledRoutines();
  for (const routine of routines) {
    if (!routine.events.some((e) => DELIVERY_ROUTINE_EVENTS.includes(e as never))) continue;
    const source = histories.find((h) => h.projectId === routine.projectId);
    if (!source) continue;
    const { cursor, events } = pendingDeliveryEvents(routine, source.history, workspaceDeliveries());
    if (JSON.stringify(cursor) === JSON.stringify(routine.triggerState.delivery)) continue;
    // shortcut: consume before firing to avoid duplicate agent jobs after restart; add a durable outbox if guaranteed execution is needed.
    await updateRoutine(routine.id, { triggerState: { ...routine.triggerState, delivery: cursor } });
    for (const event of events) {
      await fire(routine, event.type as (typeof DELIVERY_ROUTINE_EVENTS)[number], {
        id: event.id, at: event.at, pr: { ...event.pr, branch: event.branch }, checks: event.checks,
        previewUrl: event.previewUrl, workspace: { id: routine.targetWorkspaceId, branch: event.branch },
      }).catch((err) => console.error("[thunk] delivery routine failed to start", err));
    }
  }
}
