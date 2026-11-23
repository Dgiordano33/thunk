# Integrations

Thunk talks to Slack and Linear itself, with no model in the loop: Slack tells you when something needs you, and
Linear issues assigned to you become tasks. Agents keep using MCP connectors for ad-hoc reads and writes during a
session.

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

## Linear

Issues assigned to you become tasks in the Thunk project you map their team to. Thunk polls Linear every two minutes
(it sits behind Tailscale, so Linear's webhooks cannot reach it).

### Set up

1. In Linear, open **Settings → Security & access** and create a personal API key.
2. In Thunk, open **Settings → Integrations**, paste it into Linear's **API key** field and **Save**. Thunk checks the
   key before saving it.
3. Pick a Linear team for each project that should get tasks. The first sync starts right away.

### How tasks follow issues

- Every open issue assigned to you in the mapped team becomes a task, with the issue key (`ENG-123`) linking back to
  Linear. Title, description, status and priority come from the issue.
- **Linear is the source of truth.** Whenever an issue changes in Linear, the task takes Linear's title, description,
  status and priority, replacing edits made in Thunk. Edits made in Thunk stay until the issue next changes in Linear.
- Status follows Linear's state type: triage, backlog and unstarted are **Open**, started is **In progress**,
  completed is **Done** and canceled is **Cancelled**. Linear has no Blocked.
- An issue that is completed, canceled, reassigned to someone else or deleted closes its task (Done or Cancelled).
  An issue reopened and assigned back to you reopens it.
- Sending a Linear task to **New worktree** creates the branch `thunk/<issue-key>-<title>`, so Linear's GitHub
  integration attaches the PR to the issue and moves it when the PR merges.

### Thunk updates Linear

With **Update Linear from Thunk** on (the default), Thunk moves issues when their tasks change here:

- A task moving to **In progress** moves an unstarted issue to the team's first started state.
- A task marked **Done** closes its issue (the team's first completed state), unless a PR is attached to the issue.
  Then Linear's GitHub integration closes it when the PR merges.
- Cancelling a task in Thunk leaves the issue alone, and Thunk never reopens an issue.

Thunk reads the issue before each change, so it never echoes back a change it just copied from Linear.

### Routines

Imported tasks fire `task_created` routines like any task, and `task_completed` when they become Done. Prompts can
use `{{event.task.external.key}}` and `{{event.task.external.url}}` for the Linear issue.

### Agents get Linear's tools

With a key saved, every session also gets Linear's hosted MCP server (`https://mcp.linear.app/mcp`, authenticated
with the same key), so agents can read and update issues on the Droplet with no sign-in. A connector you named
`linear` yourself, in a project's **Connectors** or `~/.thunk/config/mcp.json`, takes its place.

The key is stored in `~/.thunk/config/integrations.json` beside the Slack token, under the same protections.
`LINEAR_API_KEY` in the server's environment wins over the saved key.
