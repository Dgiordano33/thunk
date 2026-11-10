import "server-only";
import { subscribe, type LiveSession } from "@/lib/agent";
import type { HarnessEvent } from "@/lib/agent/types";
import type { RunStatus } from "@/lib/routines/types";
export type WorkerResult = { status: RunStatus; error: string | null; markdown: string; costUsd: number; sessionId: string };
export function watchWorker(live: LiveSession, maxMinutes: number, hooks: {
  waitForQueue?: boolean;
  /** Stop the clock while a person owes an answer; answering starts a fresh window. */
  pauseWhileAwaiting?: boolean;
  finish: (result: WorkerResult) => void | Promise<void>;
  status?: (status: RunStatus) => void | Promise<unknown>;
}, cancelled: () => string | null = () => null) {
  let markdown = "";
  let costUsd = 0;
  let lastError: string | null = null;
  let status: RunStatus = "running";
  let done = false;
  let timer: ReturnType<typeof setTimeout>;

  const finish = (final: RunStatus, error: string | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
    Promise.resolve(hooks.finish({ status: final, error, markdown, costUsd, sessionId: live.id })).catch((err) =>
      console.error("[thunk] worker lifecycle finalize failed", err),
    );
  };

  const setStatus = (next: RunStatus) => {
    if (done || next === status) return;
    status = next;
    Promise.resolve(hooks.status?.(next)).catch((err) => console.error("[thunk] worker lifecycle update failed", err));
  };

  const onEvent = (e: HarnessEvent) => {
    switch (e.type) {
      case "turn_complete":
        if (e.markdown) markdown = e.markdown;
        break;
      case "error":
        lastError = e.message;
        break;
      case "result":
        costUsd += e.costUsd || 0;
        if (live.pending.size === 0 && (!hooks.waitForQueue || !live.queuedMessages.length)) finish(e.isError ? "failed" : "succeeded", e.isError ? lastError ?? `Agent stopped: ${e.subtype}` : null);
        break;
      case "status":
        if (e.state === "awaiting") {
          setStatus("needs_attention");
          if (hooks.pauseWhileAwaiting) clearTimeout(timer);
        } else if (e.state === "running" && status === "needs_attention") {
          setStatus("running");
          if (hooks.pauseWhileAwaiting) startTimer();
        }
        else if (e.state === "error") finish("failed", lastError ?? "Session error");
        else if (e.state === "closed") finish("cancelled", cancelled() ?? "Session closed before the run finished");
        break;
    }
  };

  const startTimer = () => {
    timer = setTimeout(() => {
      if (done) return;
      void live.driver.interrupt().catch(() => {});
      finish("failed", `Timed out after ${maxMinutes} min`);
    }, maxMinutes * 60_000);
    timer.unref?.();
  };
  const unsubscribe = subscribe(live, onEvent);
  startTimer();
  return () => { done = true; clearTimeout(timer); unsubscribe(); };
}

