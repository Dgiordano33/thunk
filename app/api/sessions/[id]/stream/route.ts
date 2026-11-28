import type { NextRequest } from "next/server";
import { getSession, subscribe } from "@/lib/agent";
import type { HarnessEvent } from "@/lib/agent/types";
import { loadEvents } from "@/lib/db/repo/messages";
import { getSessionRow } from "@/lib/db/repo/sessions";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/**
 * SSE stream of harness events. Replays everything after `?since=<seq>` (or
 * the Last-Event-ID header on EventSource auto-reconnect), then goes live.
 *
 * A session that isn't in memory (ended and swept, or from before a restart) replays from the
 * database, then sends `not_live` and ends; the client stops there until it resumes the session.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/sessions/[id]/stream">) {
  const { id } = await ctx.params;
  const since = Math.max(
    Number(req.nextUrl.searchParams.get("since") ?? 0) || 0,
    Number(req.headers.get("last-event-id") ?? 0) || 0,
  );

  const live = getSession(id);
  if (!live) return replayPersisted(id, since);

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
      const send = (e: HarnessEvent) => write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);

      // Preamble defeats proxy/dev buffering so the client sees `open` immediately.
      write(`:ok\n\n`);
      for (const e of live.events) if (e.seq > since) send(e);
      const unsubscribe = subscribe(live, send, { viewer: true });
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

  return new Response(stream, { headers: SSE_HEADERS });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** History after `since` from the database, then `not_live`. The long `retry` keeps older clients from polling. */
async function replayPersisted(id: string, since: number) {
  const row = await getSessionRow(id).catch(() => null);
  if (!row) return Response.json({ error: "Session is not live" }, { status: 404 });
  const events = await loadEvents(id, { after: since });
  const body = `:ok\n\nretry: 600000\n\n${events.map((e) => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`).join("")}event: not_live\ndata: {}\n\n`;
  return new Response(body, { headers: SSE_HEADERS });
}
