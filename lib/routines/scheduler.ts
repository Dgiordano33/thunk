import "server-only";
import { ensureDeliveryPolling } from "@/lib/projects/delivery";
import { getSession, isTerminated } from "@/lib/agent";
import { archiveWorkspace } from "@/lib/projects/archive";
import { projectEvents } from "@/lib/projects/events";
import { getRoutine, listDueRoutines, listOpenRuns, updateRun } from "@/lib/db/repo/routines";
import { enqueueTriggers, triggerForRun } from "@/lib/db/repo/routine-triggers";
import { computeNextRun } from "./cron";
import { pollDeliveryRoutines } from "./delivery-poll";
import { dispatchTriggers } from "./dispatch";
import { pollPullRequests } from "./pr-poll";
import { pollLinear } from "@/lib/integrations/linear/service";
import { isRunActive } from "./runner";
import { routinesState as state } from "./state";
import { subscribeTasks } from "@/lib/tasks/events";
import { onRunFailed, onTaskEvent } from "./triggers";
import type { Routine } from "./types";

const TICK_MS = 30_000;
/** PR polling runs every Nth tick (~2 min). */
const PR_POLL_EVERY = 4;

const nextRunIso = (r: Pick<Routine, "scheduleCron" | "scheduleTz">, after: Date) =>
  computeNextRun(r.scheduleCron, r.scheduleTz, after)?.toISOString() ?? null;

/** One cron firing per routine and slot, so a tick that runs twice (or a crash mid-tick) can't double it. */
const cronKey = (routine: Routine) => `cron:${routine.id}:${routine.nextRunAt}`;

/** Queue due cron routines and advance their next run, poll for events, then start whatever is due. */
async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const now = new Date();
    for (const routine of await listDueRoutines(now)) {
      await enqueueTriggers(routine.id, [{ source: "cron", dedupeKey: cronKey(routine) }], { nextRunAt: nextRunIso(routine, now) })
        .catch((err) => console.error(`[thunk] routine "${routine.name}" couldn't be queued`, err));
    }
    await pollDeliveryRoutines().catch((err) => console.error("[thunk] delivery routine poll failed", err));
    if (++state.tickCount % PR_POLL_EVERY === 0) {
      await pollPullRequests().catch((err) => console.error("[thunk] PR poll failed", err));
      await pollLinear();
    }
    await dispatchTriggers();
  } catch (err) {
    console.error("[thunk] routines tick failed", err);
  } finally {
    state.ticking = false;
  }
}

/**
 * After a restart: runs that were open belong to sessions that died with the old process, so mark them
 * interrupted and archive their per-run worktrees. A routine that catches up retries an interrupted run once
 * from its trigger, and queues one firing for missed cron slots; every schedule is recomputed from now.
 * Pending triggers are left alone: the first tick's dispatcher starts them under the usual guardrails.
 */
async function reconcile() {
  for (const run of await listOpenRuns()) {
    if (isRunActive(run.id)) continue;
    const live = run.sessionId ? getSession(run.sessionId) : null;
    if (live && !isTerminated(live)) continue;
    await updateRun(run.id, { status: "failed", finishedAt: new Date().toISOString(), error: "Interrupted: Thunk server restarted" });
    const routine = await getRoutine(run.routineId);
    if (run.workspaceId && routine?.targetKind === "ephemeral")
      await archiveWorkspace(run.workspaceId).catch((err) => console.error("[thunk] routine archive failed", err));
    if (routine?.catchUp === "once") await retryInterrupted(run.id);
  }
  const now = new Date();
  for (const routine of await listDueRoutines(now)) {
    const missed = routine.catchUp === "once" ? [{ source: "cron" as const, dedupeKey: cronKey(routine), payload: { catchUp: true, missedAt: routine.nextRunAt } }] : [];
    await enqueueTriggers(routine.id, missed, { nextRunAt: nextRunIso(routine, now) });
  }
}

/** Queue an interrupted run's trigger again, once: a retry's own trigger is never retried. */
async function retryInterrupted(runId: string) {
  const trigger = await triggerForRun(runId);
  if (!trigger || trigger.dedupeKey.startsWith("retry:")) return;
  await enqueueTriggers(trigger.routineId, [{ source: trigger.source, dedupeKey: `retry:${trigger.id}`, payload: trigger.payload }]);
}

/** Start the routines scheduler once per server process. Safe to call from anywhere, any number of times. */
export function ensureScheduler() {
  ensureDeliveryPolling();
  // Point the long-lived timer and listeners at this module's code (matters after HMR).
  state.tick = tick;
  state.onRunFailed = (event) => void onRunFailed(event).catch((err) => console.error("[thunk] run_failed trigger", err));
  state.onTaskEvent = (event) => void onTaskEvent(event).catch((err) => console.error("[thunk] task trigger", err));
  if (!state.listenersBound) {
    state.listenersBound = true;
    projectEvents().on("run_failed", (event) => state.onRunFailed(event));
    subscribeTasks((event) => state.onTaskEvent(event));
  }
  if (state.timer) return;
  state.timer = setInterval(() => void state.tick(), TICK_MS);
  state.timer.unref?.();
  console.log("[thunk] routines scheduler started");
  if (!state.booted) {
    state.booted = true;
    void reconcile()
      .catch((err) => console.error("[thunk] routines reconcile failed", err))
      .then(() => state.tick());
  }
}

/** Recompute a routine's next run after its schedule or enabled flag changed. */
export function scheduleFields(r: Pick<Routine, "scheduleCron" | "scheduleTz" | "enabled">) {
  return { nextRunAt: r.enabled ? nextRunIso(r, new Date()) : null };
}
