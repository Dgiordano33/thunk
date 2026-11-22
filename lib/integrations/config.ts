import "server-only";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { sharedConfigDir } from "@/lib/projects/paths";

/**
 * Integration credentials, in `~/.thunk/config/integrations.json` (0600). Agents may not read, edit or write it
 * (lib/agent/options.ts). SLACK_BOT_TOKEN and SLACK_USER_ID in the environment win over the file.
 */
const Integrations = z.object({
  slack: z.object({
    botToken: z.string().optional(),
    /** Your Slack member ID: Thunk DMs you through the bot. */
    userId: z.string().optional(),
    enabled: z.boolean().default(false),
  }).default({ enabled: false }),
});
type Integrations = z.infer<typeof Integrations>;

export const integrationsFile = () => path.join(sharedConfigDir(), "integrations.json");

async function read(): Promise<{ config: Integrations; raw: string | null }> {
  const raw = await readOptional(integrationsFile()).catch(() => null);
  try { return { config: Integrations.parse(raw ? JSON.parse(raw) : {}), raw }; }
  catch { return { config: Integrations.parse({}), raw }; }
}

export type SlackSettings = { botToken: string | null; userId: string | null; enabled: boolean; tokenFromEnv: boolean; userFromEnv: boolean };

export async function slackSettings(): Promise<SlackSettings> {
  const { slack } = (await read()).config;
  const envToken = process.env.SLACK_BOT_TOKEN?.trim();
  const envUser = process.env.SLACK_USER_ID?.trim();
  return { botToken: envToken || slack.botToken || null, userId: envUser || slack.userId || null, enabled: slack.enabled, tokenFromEnv: Boolean(envToken), userFromEnv: Boolean(envUser) };
}

/** `botToken: ""` clears the stored token; leaving it out keeps it. */
export async function updateSlackSettings(patch: { botToken?: string; userId?: string; enabled?: boolean }) {
  const file = integrationsFile();
  await withFileLock(file, async () => {
    const { config, raw } = await read();
    const slack = { ...config.slack };
    if (patch.botToken !== undefined) slack.botToken = patch.botToken.trim() || undefined;
    if (patch.userId !== undefined) slack.userId = patch.userId.trim() || undefined;
    if (patch.enabled !== undefined) slack.enabled = patch.enabled;
    await mkdir(sharedConfigDir(), { recursive: true, mode: 0o700 });
    await replaceFile(file, JSON.stringify({ ...config, slack }, null, 2) + "\n", raw);
    await chmod(file, 0o600);
  });
}

/** What the browser may see: never the token itself. */
export function publicSlack(s: SlackSettings) {
  return { hasToken: Boolean(s.botToken), tokenHint: s.botToken ? `…${s.botToken.slice(-4)}` : null, userId: s.userId, enabled: s.enabled, tokenFromEnv: s.tokenFromEnv, userFromEnv: s.userFromEnv };
}
export type PublicSlack = ReturnType<typeof publicSlack>;
