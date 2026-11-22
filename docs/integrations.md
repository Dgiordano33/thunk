# Integrations

Thunk talks to Slack itself, with no model in the loop, to tell you when something needs you. Agents keep using MCP
connectors for ad-hoc reads and writes during a session.

## Slack

Thunk DMs you through a Slack app you create. When a notification you chose is still unread in Thunk after 30
seconds, it arrives as a DM with an **Open in Thunk** button. When the notification is resolved or dismissed in
Thunk, the DM is crossed out. If you read it in Thunk within the 30 seconds, nothing is sent.

### Set up

1. Go to [api.slack.com/apps](https://api.slack.com/apps?new_app=1), choose **Create New App → From a manifest**,
   pick your workspace and paste the manifest below (also in **Settings → Integrations**, with a copy button).
2. Install the app to your workspace. On **OAuth & Permissions**, copy the **Bot User OAuth Token** (`xoxb-…`).
3. In Slack, open your profile and choose **⋯ → Copy member ID**.
4. In Thunk, open **Settings → Integrations**, paste both, **Save**, then **Send test DM** and **Turn on**.

```yaml
display_information:
  name: Thunk
  description: Tells you when your Thunk agents need you.
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: true
  bot_user:
    display_name: Thunk
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - im:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

The app can only post: `chat:write` sends and edits its own messages, and `im:write` opens the DM with you.

### What gets sent

Choose kinds in **Settings → Notifications**, in the Slack column. By default only **Needs you** kinds are sent
(permissions, questions, plans, chief plans, agent requests and review requests). These choices, and which kinds
raise desktop alerts, are stored on the server in `~/.thunk/config/notifications.json`, so every device that opens
the server agrees.

Links point at `THUNK_PUBLIC_URL`, or the first `THUNK_TRUSTED_HOSTS` entry, as `https://<host>`. On a Droplet set up
with `docs/server.md`, that is already your tailnet address.

### Where the token lives

`~/.thunk/config/integrations.json`, mode 0600. The settings screen never shows it again. Claude sessions are denied
reading, editing or writing it. Codex's sandbox cannot deny reads, so a Codex session could read the file if asked
to; the token only lets the app post to you. To keep it out of the file entirely, set `SLACK_BOT_TOKEN` and
`SLACK_USER_ID` in the server's environment (`thunk env` on a server), which win over the saved values.
