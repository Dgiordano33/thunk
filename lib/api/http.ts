import "server-only";
import type { z } from "zod";
import { getSession, type LiveSession } from "@/lib/agent";

import { HttpError } from "./errors";
export { HttpError } from "./errors";

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
}

export function requireLive(id: string): LiveSession {
  const live = getSession(id);
  if (!live) throw new HttpError(409, "Session is not live. Resume it first.");
  return live;
}

/** Wrap a route handler so thrown HttpErrors become JSON responses. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      console.error("[thunk] route error", err);
      return Response.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
    }
  };
}
