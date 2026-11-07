import { handle } from "@/lib/api/http";
import { listWorkspaces } from "@/lib/supabase/repo/workspaces";

export const dynamic = "force-dynamic";

export const GET = handle(async () => Response.json({ workspaces: await listWorkspaces() }));
