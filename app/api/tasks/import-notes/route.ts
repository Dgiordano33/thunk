import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { importNoteTasks, noteImportCandidates } from "@/lib/tasks/service";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId");
  return Response.json({ count: (await noteImportCandidates(projectId ? { projectId } : { workspaceId: params.get("workspaceId") ?? "" })).length });
});
export const POST = handle(async (req: Request) => {
  const scope = await parseBody(req, z.union([z.object({ workspaceId: z.uuid() }).strict(), z.object({ projectId: z.uuid() }).strict()]));
  return Response.json({ imported: await importNoteTasks(scope) });
});
