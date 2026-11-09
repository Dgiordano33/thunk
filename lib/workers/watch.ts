import "server-only";
import { subscribe, type LiveSession } from "@/lib/agent";
import type { HarnessEvent } from "@/lib/agent/types";
import type { RunStatus } from "@/lib/routines/types";
export type WorkerResult = { status: RunStatus; error: string | null; markdown: string; costUsd: number; sessionId: string };
export function watchWorker(live: LiveSession, maxMinutes: number, hooks: {
  waitForQueue?: boolean;
  finish: (result: WorkerResult) => void | Promise<void>;
  status?: (status: RunStatus) => void | Promise<unknown>;
}, cancelled: () => string | null = () => null) {
  let markdown = "";
  let costUsd = 0;
  let lastError: string | null = null;
  let status: RunStatus = "running";
  let done = false;

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
        if (e.state === "awaiting") setStatus("needs_attention");
        else if (e.state === "running" && status === "needs_attention") setStatus("running");
        else if (e.state === "error") finish("failed", lastError ?? "Session error");
        else if (e.state === "closed") finish("cancelled", cancelled() ?? "Session closed before the run finished");
        break;
    }
  };

  const unsubscribe = subscribe(live, onEvent);
  const timer = setTimeout(() => {
    if (done) return;
    void live.driver.interrupt().catch(() => {});
    finish("failed", `Timed out after ${maxMinutes} min`);
  }, maxMinutes * 60_000);
  timer.unref?.();
  return () => { done = true; clearTimeout(timer); unsubscribe(); };
}

