import "server-only";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { ContextSetInputSchema, ContextSetPatchSchema } from "@/lib/context/schema";
import { ContextSetNameTaken, deleteContextSet, getContextSet, insertContextSet, listContextSets, updateContextSet } from "@/lib/db/repo/context-sets";
import { getProject } from "@/lib/db/repo/projects";
import { listRoutines, updateRoutine } from "@/lib/db/repo/routines";
import { renderRoutineContext, validateRoutineContext } from "@/lib/routines/context";
import type { LiveSession } from "@/lib/agent";
import { recordContextItems } from "./record";

// Route handlers for /api/projects/[id]/context-sets and /api/context-sets/[id].

type Ctx<P> = { params: Promise<P> };

/**
 * Refuse a missing set, or one from another project when the project is known, before a session is created for it,
 * so a bad id doesn't leave an empty session behind. sessionSetContext checks the project again once it is.
 */
export async function checkSessionSet(setId: string, projectId?: string | null) {
  const set = await getContextSet(setId);
  if (!set || (projectId && set.projectId !== projectId)) throw new HttpError(400, "That context set isn't in this project");
}

/** A new session's saved set, read now and recorded as attached; "" when the set is empty. */
export async function sessionSetContext(live: LiveSession, setId: string) {
  const set = await getContextSet(setId);
  if (!set || set.projectId !== live.ctx.project.id) throw new HttpError(400, "That context set isn't in this project");
  const part = await renderRoutineContext({ project: live.ctx.project, context: { notes: [], taskIds: [], setId }, trigger: "manual", subject: "this session" });
  void recordContextItems(live.id, "attached", part.items);
  return part.text;
}

async function project(id: string) {
  const p = await getProject(id);
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

const taken = (err: unknown): never => {
  throw err instanceof ContextSetNameTaken ? new HttpError(409, err.message) : err;
};

export const collection = {
  GET: handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
    const p = await project((await ctx.params).id);
    return Response.json({ sets: await listContextSets(p.id) });
  }),
  POST: handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
    const p = await project((await ctx.params).id);
    const input = await parseBody(req, ContextSetInputSchema);
    await validateRoutineContext(p, input);
    return Response.json({ set: await insertContextSet(p.id, input).catch(taken) }, { status: 201 });
  }),
};

export const item = {
  GET: handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
    const set = await getContextSet((await ctx.params).id);
    if (!set) throw new HttpError(404, "Context set not found");
    return Response.json({ set });
  }),
  PATCH: handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
    const current = await getContextSet((await ctx.params).id);
    if (!current) throw new HttpError(404, "Context set not found");
    const patch = await parseBody(req, ContextSetPatchSchema);
    await validateRoutineContext(await project(current.projectId), { notes: patch.notes ?? [], taskIds: patch.taskIds ?? [], vaultIds: patch.vaultIds ?? [] });
    return Response.json({ set: await updateContextSet(current.id, patch).catch(taken) });
  }),
  /** Routines that pointed at the set go back to their own lists. */
  DELETE: handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
    const current = await getContextSet((await ctx.params).id);
    if (!current) throw new HttpError(404, "Context set not found");
    for (const r of await listRoutines({ projectId: current.projectId }))
      if (r.context.setId === current.id) await updateRoutine(r.id, { context: { ...r.context, setId: null } });
    await deleteContextSet(current.id);
    return Response.json({ ok: true });
  }),
};
