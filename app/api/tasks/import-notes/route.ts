import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { importNoteTasks, noteImportCandidates } from "@/lib/tasks/service";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId");
  const items = await noteImportCandidates(projectId ? { projectId } : { workspaceId: params.get("workspaceId") ?? "" });
  return Response.json({ count: items.length, folders: [...new Set(items.flatMap((i) => i.folder ? [i.folder] : []))] });
});
export const POST = handle(async (req: Request) => {
  const scope = await parseBody(req, z.union([z.object({ workspaceId: z.uuid() }).strict(), z.object({ projectId: z.uuid() }).strict()]));
  return Response.json({ imported: await importNoteTasks(scope) });
});
