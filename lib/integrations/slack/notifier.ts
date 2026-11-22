// Slack DMs for notifications, with no model in the loop. Pure: the wiring (lib/integrations/slack/index.ts) passes
// real settings, storage and a client; tests pass fakes.
import type { Notification, NotificationEvent, NotificationKind } from "@/lib/notifications/types";
import type { SlackClient, SlackMessage } from "./client";

export type SlackRef = { channel: string; ts: string };
export type NotifierDeps = {
  /** Null when Slack is off or not set up. */
  settings: () => Promise<{ botToken: string; userId: string } | null>;
  kinds: () => Promise<readonly NotificationKind[]>;
  client: (token: string) => SlackClient;
  getNotification: (id: string) => Promise<Notification | null>;
  projectName: (id: string) => Promise<string | null>;
  publicUrl: () => string;
  saveRef: (notificationId: string, ref: SlackRef) => Promise<void>;
  getRef: (notificationId: string) => Promise<SlackRef | null>;
  /** Wait this long before posting, so you aren't pinged for what you already saw at the keyboard. */
  delayMs: number;
  log?: (message: string, error?: unknown) => void;
};

/** Slack mrkdwn treats &, < and > as markup. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function slackMessage(n: Notification, project: string | null, url: string): SlackMessage {
  const settled = n.status !== "open";
  const title = esc(n.title);
  const detail = n.detail ? `\n${esc(n.detail.length > 600 ? `${n.detail.slice(0, 600)}…` : n.detail)}` : "";
  const context = [project && esc(project), settled && (n.status === "resolved" ? "✓ Resolved in Thunk" : "Dismissed in Thunk")].filter(Boolean).join(" · ");
  return {
    text: settled ? `${n.title} (${n.status})` : n.title,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: settled ? `~${title}~` : `*${title}*${detail}` } },
      ...(context ? [{ type: "context", elements: [{ type: "mrkdwn", text: context }] }] : []),
      ...(settled ? [] : [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Thunk" }, url }] }]),
    ],
  };
}

export function createSlackNotifier(deps: NotifierDeps) {
  const log = deps.log ?? ((message, error) => console.error(`[thunk] slack: ${message}`, error ?? ""));
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const settled = new Set<string>();
  const dms = new Map<string, string>();
  const url = (n: Notification) => new URL(n.href, deps.publicUrl()).href;

  async function deliver(id: string) {
    pending.delete(id);
    const settings = await deps.settings();
    if (!settings) return;
    const n = await deps.getNotification(id);
    if (!n || n.status !== "open" || n.readAt) return;
    if (!(await deps.kinds()).includes(n.kind)) return;
    const client = deps.client(settings.botToken);
    let channel = dms.get(settings.userId);
    if (!channel) { channel = await client.openDm(settings.userId); dms.set(settings.userId, channel); }
    const ref = await client.post(channel, slackMessage(n, await deps.projectName(n.projectId), url(n)));
    await deps.saveRef(id, ref);
  }

  async function settle(n: Notification) {
    // Claim before any await, so a burst of update events edits the DM once.
    if (settled.has(n.id)) return;
    settled.add(n.id);
    if (settled.size > 2000) settled.delete(settled.values().next().value!);
    try {
      const ref = await deps.getRef(n.id);
      const settings = ref && await deps.settings();
      if (!ref || !settings) return;
      await deps.client(settings.botToken).update(ref.channel, ref.ts, slackMessage(n, await deps.projectName(n.projectId), url(n)));
    } catch (error) {
      settled.delete(n.id);
      throw error;
    }
  }

  return {
    handle(event: NotificationEvent) {
      const n = event.notification;
      if (event.kind === "opened") {
        if (pending.has(n.id)) return;
        settled.delete(n.id);
        pending.set(n.id, setTimeout(() => void deliver(n.id).catch((error) => log(`could not send "${n.title}"`, error)), deps.delayMs));
        return;
      }
      if (n.status !== "open" || n.readAt) {
        const timer = pending.get(n.id);
        if (timer) { clearTimeout(timer); pending.delete(n.id); }
      }
      if (n.status !== "open") void settle(n).catch((error) => log(`could not update "${n.title}"`, error));
      else if (settled.has(n.id)) settled.delete(n.id); // restored from a dismissal
    },
    /** For tests and shutdown. */
    pendingCount: () => pending.size,
  };
}
