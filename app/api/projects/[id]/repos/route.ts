import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { addProjectRepo } from "@/lib/projects";
import { cloneRepo } from "@/lib/projects/git";
import { getProject } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

/** The project's additional repos (its primary repo is the project root itself). */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/repos">) => {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "Project not found");
  return Response.json({ repos: project.extraRepos });
});

const AddBody = z.union([
  z.object({ source: z.literal("folder").optional(), path: z.string().min(1, "path is required"), name: z.string().max(80).optional() }),
  z.object({
    source: z.literal("github"),
    url: z.string().min(1, "url is required"),
    parent: z.string().min(1, "parent folder is required"),
    name: z.string().max(80).optional(),
  }),
]);

/** Add another git repo to the project: an existing checkout, or a fresh clone of a GitHub repo. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]/repos">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, AddBody);
  if (!(await getProject(id))) throw new HttpError(404, "Project not found");
  const repo = await (async () => {
    const path = body.source === "github" ? await cloneRepo(body.url, body.parent) : body.path;
    return addProjectRepo(id, path, { name: body.name });
  })().catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  return Response.json({ repo }, { status: 201 });
});
