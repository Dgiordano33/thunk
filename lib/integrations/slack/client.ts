// Slack Web API over fetch: the four calls Thunk needs, no SDK. Pure (no server-only) so tests can use a fake fetch.

export class SlackError extends Error {
  code: string;
  constructor(code: string) {
    super(SLACK_ERRORS[code] ?? `Slack said: ${code}`);
    this.code = code;
  }
}

const SLACK_ERRORS: Record<string, string> = {
  invalid_auth: "Slack rejected the token. Copy the Bot User OAuth Token (it starts with xoxb-) again.",
  not_authed: "No Slack token is saved.",
  account_inactive: "That Slack app or workspace is no longer active.",
  token_revoked: "That Slack token was revoked. Reinstall the app and copy the new token.",
  missing_scope: "The Slack app is missing a scope. Add chat:write and im:write, then reinstall it.",
  user_not_found: "No Slack user has that member ID.",
  cannot_dm_bot: "That member ID belongs to a bot. Use your own member ID.",
  ratelimited: "Slack is rate limiting Thunk. Try again in a minute.",
};

export type SlackMessage = { text: string; blocks?: unknown[] };
export type SlackClient = {
  authTest(): Promise<{ team: string; user: string }>;
  openDm(userId: string): Promise<string>;
  post(channel: string, message: SlackMessage): Promise<{ channel: string; ts: string }>;
  update(channel: string, ts: string, message: SlackMessage): Promise<void>;
};

export function slackClient(token: string, fetchImpl: typeof fetch = fetch): SlackClient {
  const call = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
    const response = await fetchImpl(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429) throw new SlackError("ratelimited");
    const data = (await response.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) throw new SlackError(data.error ?? `http_${response.status}`);
    return data;
  };
  return {
    authTest: async () => {
      const r = await call<{ team: string; user: string }>("auth.test", {});
      return { team: r.team, user: r.user };
    },
    openDm: async (userId) => (await call<{ channel: { id: string } }>("conversations.open", { users: userId })).channel.id,
    post: async (channel, message) => {
      const r = await call<{ channel: string; ts: string }>("chat.postMessage", { channel, ...message, unfurl_links: false, unfurl_media: false });
      return { channel: r.channel, ts: r.ts };
    },
    update: async (channel, ts, message) => { await call("chat.update", { channel, ts, ...message }); },
  };
}
