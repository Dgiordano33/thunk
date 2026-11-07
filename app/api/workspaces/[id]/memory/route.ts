import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { readMemory, writeMemory } from "@/lib/projects/memory";
import { workspaceMemoryFile } from "@/lib/projects/paths";

export const dynamic = "force-dynamic";

async function file(id: string) {
  const ctx = await getWorkspaceContext(id);
  if (!ctx) throw new HttpError(404, "Workspace not found");
  return workspaceMemoryFile(ctx.project.root, ctx.workspace.slug);
}

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/workspaces/[id]/memory">) => {
  const { id } = await ctx.params;
  const path = await file(id);
  return Response.json({ path, content: await readMemory(path) });
});

const PutBody = z.object({ content: z.string().max(200_000) });

export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/memory">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, PutBody);
  await writeMemory(await file(id), body.content);
  return Response.json({ ok: true });
});
