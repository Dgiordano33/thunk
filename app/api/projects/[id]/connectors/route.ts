import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { Connectors, maskConnectors, readConnectors, saveConnectors } from "@/lib/projects/connectors";
import { getProject } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";
async function key(id: string) {
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "Project not found");
  return project.dataKey;
}
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/connectors">) => {
  const result = await readConnectors(await key((await ctx.params).id));
  return Response.json({ ...result, config: maskConnectors(result.config) });
});
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]/connectors">) => {
  const body = await parseBody(req, z.object({ config: Connectors, revision: z.string() }));
  await saveConnectors(await key((await ctx.params).id), body.config, body.revision);
  return Response.json({ ok: true });
});
