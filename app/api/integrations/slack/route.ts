import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { publicSlack, slackSettings, updateSlackSettings } from "@/lib/integrations/config";

export const dynamic = "force-dynamic";

/** Slack settings for Settings → Integrations. The token never leaves the server. */
export const GET = handle(async () => Response.json(publicSlack(await slackSettings())));

export const PUT = handle(async (req: Request) => {
  const body = await parseBody(req, z.object({
    botToken: z.string().max(300).refine((t) => !t.trim() || t.trim().startsWith("xoxb-"), "Use the Bot User OAuth Token, which starts with xoxb-").optional(),
    userId: z.string().max(40).refine((id) => !id.trim() || /^[UW][A-Z0-9]{6,}$/.test(id.trim()), "A Slack member ID looks like U0123ABCDEF").optional(),
    enabled: z.boolean().optional(),
  }));
  await updateSlackSettings(body);
  return Response.json(publicSlack(await slackSettings()));
});
