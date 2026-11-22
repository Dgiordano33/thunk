import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { readNotificationPreferences, updateNotificationPreferences } from "@/lib/notifications/preferences";
import { NOTIFICATION_KINDS } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

/** Which notification kinds raise a desktop alert and which go to Slack. Shared by every browser on this server. */
export const GET = handle(async () => Response.json(await readNotificationPreferences()));

const kinds = z.array(z.enum(NOTIFICATION_KINDS));
export const PUT = handle(async (req: Request) => {
  const body = await parseBody(req, z.object({ desktopMuted: kinds.optional(), slack: kinds.optional(), migrated: z.boolean().optional() }));
  return Response.json(await updateNotificationPreferences(body));
});
