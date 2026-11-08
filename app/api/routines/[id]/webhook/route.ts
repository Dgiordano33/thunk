import { timingSafeEqual } from "node:crypto";
import { handle, HttpError } from "@/lib/api/http";
import { fire } from "@/lib/routines/runner";
import { ensureScheduler } from "@/lib/routines/scheduler";
import { routinesState } from "@/lib/routines/state";
import { getRoutine } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;
const MIN_INTERVAL_MS = 10_000;

function tokenMatches(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read the body as text, giving up as soon as it passes the limit. */
async function readBody(req: Request) {
  const tooLarge = () => new HttpError(413, "Body over 64 KB");
  if (Number(req.headers.get("content-length")) > MAX_BODY) throw tooLarge();
  if (!req.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Trigger a routine from this machine (git hook, local cron, SSH tunnel). Token via `?token=` or
 * `Authorization: Bearer`. An optional JSON body (≤ 64 KB) becomes `{{payload}}`.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/routines/[id]/webhook">) => {
  ensureScheduler();
  const { id } = await ctx.params;
  const routine = await getRoutine(id);
  if (!routine?.webhookToken) throw new HttpError(404, "No webhook for this routine");
  const given = new URL(req.url).searchParams.get("token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!tokenMatches(given, routine.webhookToken)) throw new HttpError(401, "Invalid token");
  if (!routine.enabled) throw new HttpError(409, "Routine is disabled");

  const active = routinesState.active.get(id);
  if (active) return Response.json({ error: "A run is already in progress", runId: active.runId }, { status: 409 });
  const key = `webhook:${id}`;
  if (Date.now() - (routinesState.lastFired.get(key) ?? 0) < MIN_INTERVAL_MS) throw new HttpError(429, "Slow down: one webhook run per 10 seconds");

  const text = await readBody(req);
  let payload: Record<string, unknown> | null = null;
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text);
      payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
  }
  routinesState.lastFired.set(key, Date.now());
  const run = await fire(routine, "webhook", payload);
  if (run.status === "cancelled") return Response.json({ error: run.error, runId: run.id }, { status: 429 });
  return Response.json({ runId: run.id }, { status: 202 });
});
