import { z } from "zod";
import { handle, HttpError } from "@/lib/api/http";
import { boardFor } from "@/lib/board/service";
import { subscribeBoardChanges } from "@/lib/board/events";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/** SSE of card changes to one canvas (`?board=`, default main) made by sessions other than its own agent. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const board = z.string().max(80).safeParse(new URL(req.url).searchParams.get("board") ?? "main");
  if (!board.success) throw new HttpError(400, "Invalid canvas id");
  const { project } = await boardFor((await ctx.params).id, board.data);
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
      const unsubscribe = subscribeBoardChanges((e) => {
        if (e.projectId === project.id && e.boardId === board.data) write(`data: ${JSON.stringify({ cardId: e.cardId })}\n\n`);
      });
      const heartbeat = setInterval(() => write(`: hb ${Date.now()}\n\n`), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        req.signal.removeEventListener("abort", cleanup);
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) cleanup();
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
});
