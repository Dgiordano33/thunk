import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { importNoteTasks, noteImportCandidates } from "@/lib/tasks/service";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => Response.json({ count: (await noteImportCandidates(new URL(req.url).searchParams.get("workspaceId") ?? "")).length }));
export const POST = handle(async (req: Request) => {
  const { workspaceId } = await parseBody(req, z.object({ workspaceId: z.uuid() }).strict());
  return Response.json({ imported: await importNoteTasks(workspaceId) });
});
