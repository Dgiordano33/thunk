import "server-only";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { sharedConfigDir } from "@/lib/projects/paths";
import { DEFAULT_SLACK_KINDS, NOTIFICATION_KINDS, type NotificationKind } from "./types";

/** Which kinds reach you where, in `~/.thunk/config/notifications.json`. Shared by every browser on this server. */
const kinds = z.array(z.enum(NOTIFICATION_KINDS)).transform((list) => [...new Set(list)]);
export const NotificationPreferences = z.object({
  /** Kinds that never raise a desktop alert. */
  desktopMuted: kinds.default([]),
  /** Kinds sent to Slack once Slack is connected. */
  slack: kinds.default([...DEFAULT_SLACK_KINDS]),
  /** Set once a browser has copied its old local mute list here. */
  migrated: z.boolean().default(false),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

const file = () => path.join(sharedConfigDir(), "notifications.json");

export async function readNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await readOptional(file());
    return NotificationPreferences.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return NotificationPreferences.parse({});
  }
}

export async function updateNotificationPreferences(patch: { desktopMuted?: NotificationKind[]; slack?: NotificationKind[]; migrated?: boolean }) {
  return withFileLock(file(), async () => {
    const raw = await readOptional(file());
    const next = NotificationPreferences.parse({ ...(await readNotificationPreferences()), ...patch });
    await mkdir(sharedConfigDir(), { recursive: true, mode: 0o700 });
    await replaceFile(file(), JSON.stringify(next, null, 2) + "\n", raw);
    await chmod(file(), 0o600);
    return next;
  });
}
