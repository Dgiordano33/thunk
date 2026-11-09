import { NoteConflictError } from "@/lib/notes/file-write";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { readMemory, writeMemory } from "@/lib/projects/memory";
import { projectInstructionsFile } from "@/lib/projects/paths";
import { getProject } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

async function file(id: string) {
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "Project not found");
  return projectInstructionsFile(project.dataKey);
}

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/instructions">) => {
  const { id } = await ctx.params;
  const path = await file(id);
  return Response.json({ path, content: await readMemory(path) });
});

const PutBody = z.object({ content: z.string().max(200_000), expectedContent: z.string().max(200_000) });

export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]/instructions">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, PutBody);
  await writeMemory(await file(id), body.content, body.expectedContent).catch((err) => {
    if (err instanceof NoteConflictError) throw new HttpError(409, "Instructions changed on disk. Reload before saving.");
    throw err;
  });
  return Response.json({ ok: true });
});
