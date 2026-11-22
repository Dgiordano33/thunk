import "server-only";
import { getNotification, getSlackRef, saveSlackRef } from "@/lib/db/repo/notifications";
import { getProject } from "@/lib/db/repo/projects";
import { slackSettings } from "@/lib/integrations/config";
import { subscribeNotifications } from "@/lib/notifications/events";
import { readNotificationPreferences } from "@/lib/notifications/preferences";
import { publicUrl } from "@/lib/public-url";
import { slackClient } from "./client";
import { createSlackNotifier } from "./notifier";

const DELAY_MS = 30_000;
const g = globalThis as typeof globalThis & { __thunkSlackNotifier?: () => void };

/** DM you on Slack when a notification you chose is still unread after 30 seconds. Once per server process. */
export function ensureSlackNotifier() {
  if (g.__thunkSlackNotifier) return;
  const notifier = createSlackNotifier({
    settings: async () => {
      const s = await slackSettings();
      return s.enabled && s.botToken && s.userId ? { botToken: s.botToken, userId: s.userId } : null;
    },
    kinds: async () => (await readNotificationPreferences()).slack,
    client: (token) => slackClient(token),
    getNotification,
    projectName: async (id) => (await getProject(id).catch(() => null))?.name ?? null,
    publicUrl,
    saveRef: saveSlackRef,
    getRef: getSlackRef,
    delayMs: DELAY_MS,
  });
  g.__thunkSlackNotifier = subscribeNotifications((event) => notifier.handle(event));
}
