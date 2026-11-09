import { handle, parseBody } from "@/lib/api/http";
import { createProject } from "@/lib/projects";
import { CreateProjectBody } from "@/lib/projects/repo-spec";
import { listProjects } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

export const GET = handle(async () => Response.json({ projects: await listProjects() }));

/**
 * Create a project from a name and any number of repos. A spec that can't succeed is a 400 and nothing is
 * created; a repo that fails after that is reported in `repos` while the project and the others are kept.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateProjectBody);
  return Response.json(await createProject(body), { status: 201 });
});
