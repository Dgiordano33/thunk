import type { HarnessEvent, SessionOrigin } from "@/lib/agent/types";

/** Identify the request actually being processed, ignoring messages still in the queue. */
export function relayIdFor(origin: SessionOrigin | null | undefined, events: HarnessEvent[], through = Infinity): string | null {
  if (origin?.kind === "worker") return origin.relayId ?? null;
  if (origin?.kind !== "chief") return null;
  let content = "";
  for (const event of events) {
    if (event.seq > through) break;
    if (event.type === "user_message" && !event.queued) content = event.content;
    if (event.type === "message_dequeued") {
      const message = events.find((e) => e.type === "user_message" && e.messageId === event.messageId);
      content = message?.type === "user_message" ? message.content : "";
    }
  }
  const ids = [...content.matchAll(/<(?:relay|relay_decision|relay_resume) id="([^"]+)"|<worker_report\b[^>]*\brelay="([^"]+)"/g)].map((m) => m[1] || m[2]);
  const unique = [...new Set(ids)];
  return unique.length === 1 ? unique[0] : null;
}
