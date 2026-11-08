import { handle } from "@/lib/api/http";
import { countOpenTasks } from "@/lib/supabase/repo/tasks";
export const dynamic = "force-dynamic";
export const GET = handle(async () => Response.json({ counts: await countOpenTasks() }));
