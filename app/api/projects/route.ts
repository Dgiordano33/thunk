import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { addProject, ensureMainWorkspace } from "@/lib/projects";
import { cloneRepo, createFolder } from "@/lib/projects/git";
import { listProjects } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

export const GET = handle(async () => Response.json({ projects: await listProjects() }));

const CreateBody = z.union([
  z.object({ source: z.literal("folder").optional(), path: z.string().min(1, "path is required") }),
  z.object({
    source: z.literal("github"),
    url: z.string().min(1, "url is required"),
    parent: z.string().min(1, "parent folder is required"),
  }),
  z.object({
    source: z.literal("new"),
    parent: z.string().min(1, "parent folder is required"),
    name: z.string().min(1, "name is required"),
    git: z.boolean().optional(),
  }),
]);

/**
 * Register a project (idempotent per root) and make sure its main workspace exists. The project
 * comes from an existing folder, a fresh clone of a GitHub repo, or a newly created folder.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateBody);
  const project = await (async () => {
    if (body.source === "github") return addProject(await cloneRepo(body.url, body.parent));
    if (body.source === "new") return addProject(await createFolder(body.parent, body.name, { git: body.git }));
    return addProject(body.path);
  })().catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  const workspace = await ensureMainWorkspace(project);
  return Response.json({ project, workspace }, { status: 201 });
});
