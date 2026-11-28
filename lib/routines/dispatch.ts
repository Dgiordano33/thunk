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

async function dispatchOne(trigger: RoutineTrigger, now: Date) {
  const routine = await getRoutine(trigger.routineId);
  if (!routine || !routine.enabled) {
    await updateTrigger(trigger.id, { status: "skipped", error: routine ? "routine is turned off" : "routine no longer exists" });
    return;
  }
  const skip = async (message: string) => {
    const run = await recordSkip(routine, trigger.source, trigger.payload, message);
    await updateTrigger(trigger.id, { status: "skipped", error: message, runId: run.id });
  };
  try {
    const run = await startRun(routine, trigger.source, trigger.payload);
    await updateTrigger(trigger.id, { status: "started", runId: run.id, error: null });
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
  }
}
