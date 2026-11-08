import { subscribeNotes } from "@/lib/notes/watch";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/** SSE of note file changes on disk (UI saves and agent edits alike). */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      write(`:ok\n\n`);
      const unsubscribe = subscribeNotes((e) => write(`data: ${JSON.stringify(e)}\n\n`));
      const heartbeat = setInterval(() => write(`: hb ${Date.now()}\n\n`), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
