import "server-only";
import { getRoutine } from "@/lib/db/repo/routines";
import { listDueTriggers, updateTrigger, type RoutineTrigger } from "@/lib/db/repo/routine-triggers";
import { triggerFailedNotification } from "@/lib/notifications/routines";
import { recordSkip, RunRejected, startRun } from "./runner";

/** A trigger that can't get a slot for this long is skipped. */
export const BUSY_GIVE_UP_MS = 60 * 60_000;
/** startRun throwing is retried this many times before the trigger fails. */
export const MAX_START_RETRIES = 3;
const MIN_DELAY_MS = 30_000;
const MAX_BUSY_DELAY_MS = 5 * 60_000;

/** Wait longer the longer a trigger has waited: every tick at first, at most every five minutes. */
const busyDelay = (ageMs: number) => Math.min(MAX_BUSY_DELAY_MS, Math.max(MIN_DELAY_MS, ageMs / 2));
const later = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

/**
 * Start the pending triggers that are due. Outcomes:
 * - started: the run's id is stored on the trigger.
 * - busy (the routine is running, or every slot is taken): stays pending and is retried with backoff,
 *   then skipped after an hour.
 * - daily limit reached: skipped straight away.
 * - startRun threw: retried up to three times, then failed with an Inbox card.
 * A skip is also written to the run history as a "Skipped: …" row, as before the outbox.
 */
export async function dispatchTriggers(now = new Date()) {
  for (const trigger of await listDueTriggers(now)) {
    await dispatchOne(trigger, now).catch((err) => console.error(`[thunk] routine trigger ${trigger.id} dispatch failed`, err));
  }
}

/**
 * Triggers whose run started but whose "started" row didn't save (a brief database error). Kept so the next
 * tick retries only the bookkeeping instead of treating the trigger as unstarted and running it again.
 * On globalThis so HMR doesn't forget them.
 */
const g = globalThis as typeof globalThis & { __thunkStartedTriggers?: Map<string, string> };
const startedRuns = g.__thunkStartedTriggers ??= new Map<string, string>();

async function markStarted(triggerId: string, runId: string) {
  try {
    await updateTrigger(triggerId, { status: "started", runId, error: null });
    startedRuns.delete(triggerId);
  } catch (err) {
    console.error(`[thunk] routine trigger ${triggerId} started run ${runId} but couldn't record it; retrying next tick`, err);
  }
}

async function dispatchOne(trigger: RoutineTrigger, now: Date) {
  const startedRun = startedRuns.get(trigger.id);
  if (startedRun) return markStarted(trigger.id, startedRun);
  const routine = await getRoutine(trigger.routineId);
  if (!routine || !routine.enabled) {
    await updateTrigger(trigger.id, { status: "skipped", error: routine ? "routine is turned off" : "routine no longer exists" });
    return;
  }
  const skip = async (message: string) => {
    const run = await recordSkip(routine, trigger.source, trigger.payload, message);
    await updateTrigger(trigger.id, { status: "skipped", error: message, runId: run.id });
  };
  let runId: string;
  try {
    runId = (await startRun(routine, trigger.source, trigger.payload)).id;
  } catch (err) {
    if (err instanceof RunRejected) {
      const age = now.getTime() - new Date(trigger.createdAt).getTime();
      if (err.reason === "limit") return skip(err.message);
      if (age >= BUSY_GIVE_UP_MS) return skip(`${err.message} for an hour`);
      await updateTrigger(trigger.id, { nextAttemptAt: later(now, busyDelay(age)), error: err.message });
      return;
    }
    const message = (err as Error).message || String(err);
    const attempts = trigger.attempts + 1;
    if (attempts > MAX_START_RETRIES) {
      await updateTrigger(trigger.id, { status: "failed", attempts, error: message });
      console.error(`[thunk] routine "${routine.name}" trigger failed after ${attempts} tries: ${message}`);
      await triggerFailedNotification(routine, trigger, message).catch((e) => console.error("[thunk] routine notification failed", e));
      return;
    }
    await updateTrigger(trigger.id, { attempts, nextAttemptAt: later(now, MIN_DELAY_MS * 2 ** (attempts - 1)), error: message });
    return;
  }
  // Outside the try: once startRun has returned, the run exists, so a failure here must never start it again.
  startedRuns.set(trigger.id, runId);
  await markStarted(trigger.id, runId);
}
