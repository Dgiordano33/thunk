# Capture: one field that starts a first crack

Status: proposed · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-23

## Goal

You are on a call with time for one or two sentences. You type them into one field and press Enter. Thunk picks the project, starts an agent on a first crack (research, a plan or a draft branch) and leaves you alone. After the call, the Inbox shows what it assumed, what it did and the one step it held back.

Nothing is approved before work starts. Approval moves to the end, where a wrong guess costs one discarded worktree.

Mock: `.context/artifacts/thunk-capture/index.html` (capture bar, sent chip, Inbox Thoughts section, review card).

## Constraints from the code today

| Area | Current state | Consequence |
|---|---|---|
| Path of a thought | Top-level note checklist item → **Route** or triage → top chief `route_plan` → Inbox approval → project chief → `delegate_plan` approval → worker (`lib/home/service.ts`, `lib/workers/plans.ts`) | Two approvals and a note format before anything runs. Capture needs its own path, not a faster version of this one |
| Top chief | One long-lived session; `proposeRoutePlan` always raises an approval card | Routing a capture through it is serial and blocks on the card. Capture routes with a one-shot call instead |
| Starting a worker | `delegate(projectId, null, input)` already works with no chief: it creates the task, a fresh worktree and a worker "for the person", and the task goes to `done` when the worker finishes (`lib/workers/service.ts`) | Dispatch needs no new worker code |
| Research without code | `mode: "scout"` runs read-only in the main checkout and needs no Git repository | Research thoughts, and thoughts that fit no project, can run as scouts (in Home when no project fits) |
| One-shot model calls | `runWithClaude` in `lib/notifications/brief.ts`: tool-less, one turn, works with an API key or the local `claude` login, with a fake runner under `NEXT_PUBLIC_THUNK_E2E` | The router follows the same shape and is testable the same way |
| What to route by | `projectsOverview()` returns each project's repos, workspaces, open tasks and the start of its memory; Home memory holds routing rules; `#project` tags are parsed in `lib/home/routing.ts` | The router's input already exists |
| Worker results | `finishWorker` collects the summary, diff stat and cost, parses a `needs_person:` line, and raises a `worker_report` notification | The review card is built from this; `needs_person` becomes the held-back step |
| Worker cap | Four workers per project; extra tasks queue and start on their own | A capture can sit in `queued`; the row has to say so |
| Inbox | Sections come from notifications (`components/inbox/model.ts`); rows are settled events, not things with a lifecycle | Thoughts need their own store and section. They are not notifications |
| Desktop | `desktop/main.cjs` is one `BrowserWindow` on the backend URL (local or `THUNK_REMOTE_URL`); no `globalShortcut` yet | The OS-wide bar is a second small window on a `/capture` page, so it works against the Droplet too |
| App-wide UI | `components/providers.tsx` wraps every route; `components/ui/command.tsx` exists but nothing uses it | The in-app bar mounts once in `Providers` |

## Decisions

- **A capture is its own record.** It exists before a project is known, has a lifecycle (`routing → queued → working → ready → kept | discarded`, or `failed`) and links to the task, workspace and session once routed. One table, `captures`.
- **Routing is a one-shot call, not the top chief.** Input: the thought, `projectsOverview()`, Home routing memory. Output (JSON, validated with zod): `projectId | null`, `mode` (`scout` or `worktree`), `title`, a self-contained `brief`, and `assumptions[]`. It takes seconds, runs in parallel, and never asks. A `#project` tag in the text pins the project and skips the model's choice.
- **Ambiguity never blocks.** The router picks the likeliest project and says so in `assumptions`. When nothing fits, the capture runs as a scout in the Home project.
- **Captures skip both approval tiers, by limiting what the worker may do.** The brief ends with fixed first-crack rules: work only in this worktree; do not push, open a PR, merge, deploy, send or post anything; do not ask questions unless truly blocked; name the next step you held back in `needs_person`. Worktree captures start with `permissionMode: "acceptEdits"` so edits do not stop on a prompt mid-call. Shell permissions still go to the Inbox as Decisions, as today.
- **Scout by default.** The router chooses `worktree` only when the thought asks for something to be made or changed ("draft", "try", "fix"). "Look into", "why", "plan" and anything unclear are scouts: cheaper, faster, nothing to clean up.
- **Thoughts are a section of the Inbox, fed by captures.** Routing, queued and working rows are quiet; a ready row has **Review**. A `capture_ready` notification exists only for delivery (Slack DM, desktop alert, the Inbox count) and the Inbox list hides that kind, since the Thoughts row already shows it.
- **Review is one card with three actions.** *You said* (the raw text), *Assumed* (the router's list), *Did* (the worker's summary, diff stat, time and cost), *Next* (`needs_person`). Then:
  - **Go ahead** (labelled with the next step when there is one): sends the worker a message to do it; the capture returns to `working`.
  - **Redirect**: a one-line reply sent to the same session; the capture returns to `working`. If the redirect names another project, the capture is re-routed and the old worktree is discarded.
  - **Discard**: stops the session, cancels the task and archives the workspace, with an Undo toast. Existing housekeeping removes the worktree.
- **The input is never a note.** No notebook entry is written for the thought. If the result is worth keeping, the worker's report and the task carry it.
- **One field, three places, one component.** The Inbox field, the in-app bar and the desktop window all post to the same route and share one input component.

## Phase 1: capture to a running worker (ship first)

1. Migration `0018_captures`: `id`, `text`, `status`, `project_id`, `task_id`, `workspace_id`, `session_id`, `mode`, `title`, `assumptions jsonb`, `next_step`, `summary`, `diff_stat jsonb`, `cost_usd`, `error`, `created_at`, `updated_at`. Repo in `lib/db/repo/captures.ts`.
2. `lib/capture/router.ts`: prompt, zod schema, tag pinning via `parseRoutingItems`' tag rules, and a runner modelled on `runWithClaude` (45 s timeout, fake runner for browser tests). A parse failure or timeout retries once, then marks the capture `failed`.
3. `lib/capture/service.ts`: `createCapture(text)` inserts the row, returns at once and routes in the background; on a route it calls `delegate(projectId, null, { title, brief, mode, permissionMode })` and stores the task, workspace and session. A queued result sets `queued`. An event emitter mirrors `lib/notifications/events.ts`.
4. Worker finish: in `finishWorker`, when the task belongs to a capture, write `summary`, `diff_stat`, `cost_usd` and `next_step`, and set `ready` for `done` and `blocked`, `failed` otherwise. Queue drain sets `working` when a queued capture starts.
5. Restart: captures left in `routing` are routed again on start, beside `recoverWorkers()`.
6. API: `POST /api/captures` (201 with the row), `GET /api/captures` (open ones, newest first), `GET /api/captures/events` (SSE, same shape as `/api/notifications/events`).
7. Inbox: the field pinned above the list and a **Thoughts** section with one row per open capture: raw text, project and current activity, state badge, **Open session**. A failed row offers **Retry** and a project picker; this is the only place a picker appears.
8. Guardrail: at most 8 open captures (setting in `~/.thunk/config/`); past that the field says so and does not submit.
9. Tests: router parsing and pinning, state transitions including queued and restart, the API routes, and Inbox rows in `components/inbox/ui.test.cjs`.

## Phase 2: review and close the loop

1. Review card in the Thoughts section, built from the capture row; **Context** reuses `quick-context.tsx` for the session behind it.
2. Routes `POST /api/captures/[id]/continue`, `/redirect`, `/discard`, `/restore`. Continue and redirect use `messageWorker`; discard uses `stopWorker` and `archiveWorkspace`.
3. `capture_ready` notification kind, in the **Needs you** group so it reaches Slack by default; hidden from the Inbox list; resolved when the capture is kept or discarded.
4. Keyboard: Thoughts rows join the Inbox's roving tab stop; `1`–`3` pick the card's actions, as decisions do.
5. A redirect that moves a capture to another project offers to save a routing rule to Home memory, as the top chief does.
6. Update the Inbox section of `design.md` and add `docs/capture.md`.

## Phase 3: the bar

1. `components/capture/capture-bar.tsx`, mounted in `Providers`: a dialog with the shared field, opened by a shortcut and a HUD button. Enter submits and closes; Esc closes and keeps the text. A small chip shows Routing, then Working in *project*, and fades.
2. `/capture`: a bare route that renders only the bar, for the desktop window.
3. Desktop: register an OS-wide shortcut with Electron's `globalShortcut` in `desktop/main.cjs`; it opens a small frameless always-on-top window on `/capture`, which closes on submit, Esc or blur. Unregister on quit. The shortcut is editable in Settings and off until chosen if the default is taken.
4. Mobile: the Inbox field covers it; add a capture button to `components/mobile/tab-bar.tsx`.
5. Browser test: type, Enter, bar closes, row appears in the Inbox and reaches Working.

## Later

- Context from the call you are on (calendar event, live transcript), so "do the thing just said about pricing" works.
- Voice input in the desktop window.
- Captures that split into several tasks. Today one capture is one worker.

## Not doing

- Replacing the top chief or top-level notes. Notes stay the place for lists you curate; capture is for single thoughts.
- A chat thread on a capture. Replies happen on the review card or in the session.
- Capture from Slack. The surface is inside Thunk.
- Auto-merging or opening PRs from a capture. Every outward step waits for **Go ahead**.

## Open questions

- **Shortcut.** ⌥ Space is the placeholder. It collides with some launchers, so the default needs choosing.
- **Order in the Inbox.** The mock puts Thoughts above Decisions. Decisions block agents, so they may deserve the top.
- **Spend.** Every thought costs a routing call plus a worker run. Whether 8 open captures is the right cap, and whether a daily budget is needed, depends on real use.
- **Model.** Scouts could default to a cheaper model than worktree workers; `workers_history` has the data to decide.

## Before writing code

`AGENTS.md` requires reading the relevant guide in `node_modules/next/dist/docs/` first. For this work that means route handlers, streaming responses and the App Router layout that hosts `Providers`.
