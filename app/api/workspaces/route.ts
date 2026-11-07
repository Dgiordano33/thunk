import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { createWorkspace } from "@/lib/projects";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) throw new HttpError(400, "projectId is required");
  return Response.json({ workspaces: await listWorkspaces(projectId) });
});

const CreateBody = z.object({
  projectId: z.string().min(1),
  name: z.string().max(80).optional(),
  worktree: z.boolean().optional(),
  branch: z.string().max(200).optional(),
  baseRef: z.string().max(200).optional(),
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateBody);
  const workspace = await createWorkspace(body).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  return Response.json({ workspace }, { status: 201 });
});
