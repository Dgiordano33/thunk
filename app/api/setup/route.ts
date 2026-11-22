import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { updateAgentSettings } from "@/lib/setup/settings";
import { setupStatus } from "@/lib/setup/sync";

export const dynamic = "force-dynamic";

/** The user's own Claude Code and Codex setup on this machine: what sessions load, and the last sync from a Mac. */
export const GET = handle(async () => Response.json(await setupStatus()));

export const PATCH = handle(async (req: Request) => {
  const body = await parseBody(req, z.object({ claudeUserConfig: z.boolean() }));
  await updateAgentSettings(body);
  return Response.json(await setupStatus());
});
