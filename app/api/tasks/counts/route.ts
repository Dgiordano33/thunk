import { handle } from "@/lib/api/http";
import { countOpenTasks } from "@/lib/db/repo/tasks";
export const dynamic = "force-dynamic";
export const GET = handle(async () => Response.json({ counts: await countOpenTasks() }));
