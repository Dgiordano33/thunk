import { suggestRepoFolders } from "@/lib/notes/folders";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { addRepoFromSpec } from "@/lib/projects";
import { RepoSpec } from "@/lib/projects/repo-spec";
import { getProject } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

/** The repos and folders the project spans. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/repos">) => {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "Project not found");
  return Response.json({ repos: project.repos });
});

/** Add a repo to the project: an existing checkout, a fresh clone of a GitHub repo, or a new folder. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]/repos">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, RepoSpec);
  if (!(await getProject(id))) throw new HttpError(404, "Project not found");
  const repo = await addRepoFromSpec(id, body).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  const project = (await getProject(id))!;
  return Response.json({ repo, notebookSuggestions: await suggestRepoFolders(project) }, { status: 201 });
});
