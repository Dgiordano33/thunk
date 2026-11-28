import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { attachToSession } from "@/lib/context/actions";
import { sessionContext, sessionWorkspace } from "@/lib/context/service";

/** What the session was given: prompt items, fetched and attached ones, and what was left out, each with `changedSince`. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/sessions/[id]/context">) => {
  const { id } = await ctx.params;
  const workspace = await sessionWorkspace(id);
  if (!workspace) throw new HttpError(404, "Unknown session");
  return Response.json({ items: await sessionContext(id, workspace) });
});

const Scope = z.object({ kind: z.enum(["projects", "workspaces", "repos"]), id: z.string().min(1).max(200) });
const Attach = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), scope: Scope, id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("task"), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("vault"), id: z.string().regex(/^[a-z0-9]{10}$/) }),
]);

/** Attach a note, task or Vault item: pushed into the running session as a `<context_attachment>`. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/context">) => {
  const { id } = await ctx.params;
  const ref = await parseBody(req, Attach);
  return Response.json({ items: await attachToSession(id, ref) });
});
