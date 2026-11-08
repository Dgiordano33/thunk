import { handle } from "@/lib/api/http";
import { taskTree } from "@/lib/tasks/service";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => Response.json({ tree: await taskTree(new URL(req.url).searchParams.get("projectId") ?? "") }));
