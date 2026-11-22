import { handle, HttpError } from "@/lib/api/http";
import { slackSettings } from "@/lib/integrations/config";
import { slackClient, SlackError } from "@/lib/integrations/slack/client";
import { publicUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/** Check the token and DM the member ID once, whether or not Slack is turned on. */
export const POST = handle(async () => {
  const s = await slackSettings();
  if (!s.botToken) throw new HttpError(400, "Save a bot token first.");
  if (!s.userId) throw new HttpError(400, "Save your Slack member ID first.");
  const client = slackClient(s.botToken);
  try {
    const auth = await client.authTest();
    const channel = await client.openDm(s.userId);
    await client.post(channel, {
      text: "Thunk can reach you here.",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "*Thunk can reach you here.*\nWhen something needs you and you haven't seen it in Thunk for 30 seconds, it shows up in this DM." },
          accessory: { type: "button", text: { type: "plain_text", text: "Open Thunk" }, url: publicUrl() } },
      ],
    });
    return Response.json({ team: auth.team, bot: auth.user });
  } catch (error) {
    if (error instanceof SlackError) throw new HttpError(400, error.message);
    throw error;
  }
});
