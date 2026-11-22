# Native Linear and Slack integrations

Status: Phase 1 shipped (Slack DMs); Phase 2 built (Linear issues as tasks); Phase 3 next · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-22

## Goal

Linear issues become Thunk tasks, can start workspaces and routines, and hear back when work lands. Slack tells you when Thunk needs you, and later lets you answer from Slack.

Agents keep using MCP servers for ad-hoc reads and writes mid-session. These integrations cover only what Thunk itself has to do with no model in the loop: triggers, display, sync and notification delivery.

## Constraints from the code today

| Area | Current state | Consequence |
|---|---|---|
| Reachability | Thunk listens on loopback behind Tailscale Serve; `docs/remote.md` rules out Funnel | Linear webhooks and Slack request URLs cannot reach Thunk. Linear is polled; Slack interactivity needs Socket Mode (an outbound WebSocket) |
| Polling | `lib/routines/scheduler.ts` ticks and calls `pollPullRequests()` every ~2 min; cursors live in `routine.triggerState` | The Linear poller follows the same pattern |
| Tasks | `tasks` has no external reference; `created_by` is `user`, `agent` or `routine` | One migration adds the link columns and an `integration` author |
| Task triggers | `onTaskEvent` in `lib/routines/triggers.ts` already fires `task_created` and `task_completed` routines | Imported issues can start routines with almost no new trigger code |
| Notifications | `notify()` emits on `subscribeNotifications`; each row has `urgency`, `href` and `actions: { label, method, path, body }[]` | Slack is one more subscriber. `actions` map directly onto Slack buttons |
| Deep links | `href` is a path; the public address is only in `THUNK_TRUSTED_HOSTS` | Slack messages need a base URL setting |
| Secrets | Shared config is `~/.thunk/config/` (0700, agents denied Edit and Write but not Read) | Tokens go there in a new file that agents are also denied reading |
| Settings UI | Desktop Connections is local-only; per-project connectors are edited in `components/town/project-config.tsx` | Integration settings live in the web UI so they work on the Droplet |

## Decisions

- **Credentials are personal tokens, not OAuth.** A Linear personal API key and a Slack bot token, stored in `~/.thunk/config/integrations.json` (0600), with `LINEAR_API_KEY`, `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` as overrides in `lib/env.ts`. OAuth needs a public callback and buys nothing for a single-user app. The UI never shows a stored token (same masking as connectors).
- **Linear is polled, scoped per project.** A project maps to one Linear team, with an optional Linear project and label filter. Only issues assigned to the key's owner are imported.
- **An issue becomes a task; the task is the unit Thunk works with.** No separate "issues" surface. The task shows the issue key (`ENG-123`) as a chip linking to Linear.
- **Linear owns title and description; status is mapped by state type.** `backlog`/`unstarted` → `open`, `started` → `in_progress`, `completed` → `done`, `canceled` → `cancelled`. `blocked` has no Linear equivalent and is never pushed.
- **Let Linear's GitHub integration do the PR linking.** A workspace started from an issue gets the branch `thunk/<issue-key>-<slug>`. The issue key in the branch name lets Linear attach the PR and move the issue on merge, so Thunk does not write "done" itself when a PR exists. The `thunk/` prefix keeps the `pr_opened` self-trigger guard in `pr-poll.ts` working.
- **Slack starts outbound only.** A bot token and `chat.postMessage`, not an incoming webhook, because messages are edited when the notification resolves.
- **Slack is quiet by default.** Only `urgency: "action"` notifications post, after a 30-second delay, and not at all if the notification was read or resolved in that window (you were already at the keyboard).

## Phase 1: Slack notifications (smallest, ship first)

1. `lib/integrations/config.ts`: read and write `integrations.json` with a zod schema, file lock and masking, modelled on `lib/projects/connectors.ts`. Add `Read` denies for the file in `lib/agent/options.ts` and the Codex sandbox.
2. `lib/env.ts`: `THUNK_PUBLIC_URL` (falls back to the first `THUNK_TRUSTED_HOSTS` entry, then `http://localhost:<port>`).
3. `lib/integrations/slack/client.ts`: `postMessage`, `updateMessage`, `authTest` over `fetch`. No SDK.
4. `lib/integrations/slack/notifier.ts`: subscribe with `subscribeNotifications`, started beside the scheduler. On `opened` with action urgency, wait 30 s, re-read the row, post title, detail, project name and an **Open in Thunk** link. On `updated` to resolved or dismissed, edit the message to show it is settled.
5. Migration: `notifications.slack_channel text`, `notifications.slack_ts text`.
6. Settings UI: token, destination (a channel or a DM to yourself), which notification kinds post, and a **Send test** button that calls `authTest` and posts once.
7. `docs/integrations.md`: a Slack app manifest to paste (scopes `chat:write`, `im:write`) and the setup steps.
8. Tests: notifier with a fake client (delay, skip-if-read, edit on resolve, failed post does not break `notify`).

## Phase 2: Linear issues as tasks

1. `lib/integrations/linear/client.ts`: GraphQL over `fetch`: `viewer`, `teams`, issues by team, assignee and `updatedAt` cursor, including `identifier`, `url`, `branchName`, `state { type }`, `labels`.
2. Migration: on `tasks`, add `external_source`, `external_id`, `external_key`, `external_url`, `external_synced_at`; a unique index on `(project_id, external_source, external_id)`; `integration` in the `created_by` check.
3. Project setting `linear: { teamId, projectId?, label? }`, stored with the project's config. UI: a team picker fed by the API.
4. `lib/integrations/linear/poll.ts`, called from the scheduler tick every ~2 min: upsert tasks for matching issues, update title, body and status from Linear, mark tasks cancelled when the issue is unassigned or cancelled. The first poll imports open issues only.
5. Task UI: issue key chip, and **Start workspace** on a linked task, which calls `createWorkspace` with the branch name above and attaches the task.
6. Register a `linear` MCP connector automatically when a key is saved, so agents on the Droplet get Linear tools with no extra setup. Check first that Linear's MCP server accepts an API key as a bearer token.
7. Tests: state mapping, upsert idempotence, cursor handling, first-poll behaviour.

## Phase 3: Linear triggers and write-back

1. Routines: `task_created` already fires for imported tasks. Add `task.external` (`key`, `url`, `labels`) to the event payload and `{{event.task.external.key}}` to `lib/routines/prompt.ts`. In `onTaskEvent`, treat `integration` like `user` so imports fire, and keep `routine` excluded.
2. Add a routine-level filter "only Linear issues with label …" so not every assigned issue starts a run.
3. Write-back, each one a setting that defaults on:
   - Task moves to `in_progress` (or its workspace starts) → issue moves to the team's first `started` state.
   - Task marked `done` in Thunk with no linked PR → issue moves to the team's first `completed` state.
   - A routine run or workspace opens a PR → comment on the issue with the PR link and run summary. Hook this in `lib/routines/report.ts` and the delivery `pr_opened` path.
4. Loop guard: record the last value Thunk wrote per task and ignore the poll that reads it back.

## Phase 4: Slack reports and replies

1. Per-routine option **Post report to Slack**: summary, diff stat, PR link and cost when a run ends.
2. Socket Mode (`SLACK_APP_TOKEN`, `connections:write`): render a notification's `actions` as buttons, so permissions, plans and delegation plans can be approved or rejected from Slack. Accept events only from one configured Slack user ID, and run them through the same route handlers the Inbox uses.
3. A reply in a notification's thread is sent to that session as a message.

This phase carries the most risk (a Slack account becomes a way to approve tool use), so it ships last and behind its own setting.

## Not doing

- Linear or Slack as agent tools. MCP covers that.
- Linear webhooks, Slack slash commands or events from public URLs.
- Creating Linear issues from Thunk tasks. Agents can do it through MCP when asked.
- Notion, or a general integrations framework. Two integrations do not justify one.

## Settled questions (2026-11-22)

- Slack destination: a DM to yourself.
- Linear import: every issue assigned to you in the mapped team.
- Marking a task done in Thunk closes its Linear issue when no PR is linked (a PR closes it through Linear's GitHub integration instead). Linear stays the source of truth: the poller always takes Linear's state, so reopening the issue in Linear reopens the task, and Thunk never overwrites a state change made in Linear since its last poll.

## Files

New: `lib/integrations/` (config, `slack/`, `linear/`), `app/api/integrations/`, two migrations in `db/migrations/`, `docs/integrations.md`, tests under `tests/`.
Changed: `lib/routines/scheduler.ts`, `lib/routines/triggers.ts`, `lib/routines/prompt.ts`, `lib/routines/report.ts`, `lib/tasks/` (types, schema, service), `lib/agent/options.ts`, `lib/env.ts`, `.env.local.example`, task and settings components.

Read `node_modules/next/dist/docs/` on route handlers before writing the API routes (per `AGENTS.md`).
