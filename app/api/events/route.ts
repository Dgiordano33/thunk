import { subscribeNotes } from "@/lib/notes/watch";
import { subscribeTasks } from "@/lib/tasks/events";
import { subscribeNotifications } from "@/lib/notifications/events";
import { subscribeCaptures } from "@/lib/capture/events";

export const dynamic = "force-dynamic";

/** Multiplex passive change feeds; clients refresh snapshots after every reconnect. */
export function GET(req: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const unsubscribers: (() => void)[] = [];
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      cleanup = () => {
        if (closed) return;
        closed = true;
        req.signal.removeEventListener("abort", cleanup);
        for (const unsubscribe of unsubscribers) unsubscribe();
        if (heartbeat !== null) clearInterval(heartbeat);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      if (req.signal.aborted) { cleanup(); return; }
      const write = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
      };
      const send = (topic: string) => (event: unknown) => write(`data: ${JSON.stringify({ topic, event })}\n\n`);
      unsubscribers.push(
        subscribeNotes(send("notes")),
        subscribeTasks(send("tasks")),
        subscribeNotifications(send("notifications")),
        subscribeCaptures(send("captures")),
      );
      heartbeat = setInterval(() => write(`: hb ${Date.now()}\n\n`), 15_000);
      req.signal.addEventListener("abort", cleanup, { once: true });
      write(":ok\n\n");
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  } });
}
