import { z } from "zod";
import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { terminalSnapshot } from "@/lib/projects/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!await getWorkspaceContext(id)) throw new HttpError(404, "Workspace not found");
  const processId = z.uuid().safeParse(new URL(req.url).searchParams.get("processId"));
  if (!processId.success) throw new HttpError(400, "Invalid process ID");
  if (!terminalSnapshot(id, processId.data)) throw new HttpError(404, "Terminal not found");
  const last = Number(req.headers.get("last-event-id") ?? "0");
  let cursor = Number.isSafeInteger(last) && last >= 0 ? last : 0;
  let first = true;
  const encoder = new TextEncoder();
  let dispose = () => {};
  const body = new ReadableStream({
    start(controller) {
      let closed = false;
      const cleanup = () => { closed = true; clearInterval(timer); req.signal.removeEventListener("abort", close); };
      const close = () => { if (!closed) { cleanup(); controller.close(); } };
      dispose = cleanup;
      const poll = () => {
        if (closed) return;
        const proc = terminalSnapshot(id, processId.data);
        if (!proc) { close(); return; }
        const end = proc.offset + proc.output.length;
        const reset = cursor < proc.offset || cursor > end;
        if (first || reset || cursor < end || !proc.running) {
          const output = proc.output.slice(reset ? 0 : cursor - proc.offset);
          controller.enqueue(encoder.encode(`id: ${end}\ndata: ${JSON.stringify({ output, reset, done: !proc.running })}\n\n`));
          cursor = end; first = false;
        }
        if (!proc.running) close();
      };
      const timer = setInterval(poll, 50);
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) close(); else poll();
    },
    cancel() { dispose(); },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
});
