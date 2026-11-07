import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { addProject, ensureMainWorkspace } from "@/lib/projects";
import { listProjects } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

export const GET = handle(async () => Response.json({ projects: await listProjects() }));

const CreateBody = z.object({ path: z.string().min(1, "path is required") });

/** Register the project containing `path` (idempotent) and make sure its main workspace exists. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateBody);
  const project = await addProject(body.path).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  const workspace = await ensureMainWorkspace(project);
  return Response.json({ project, workspace }, { status: 201 });
});
