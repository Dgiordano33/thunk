# Run Thunk in any worktree: demo data, a fake agent, quiet background jobs

Status: proposal · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-20

## Goal

Any checkout of Thunk, on any machine (a Conductor workspace, a cloud sandbox, a new contributor's laptop), can start a working Thunk with realistic data and usable sessions in one command. No production data, no Claude login, no GitHub token, and nothing it does reaches the outside world.

## Why

Developing Thunk is hard outside the user's own Mac:

1. **Data points at one machine.** Project rows store absolute repo paths (`/Users/<user>/...`). `npm run db:pull` copies production data, but the paths only resolve on the Mac and the server.
2. **Sessions depend on files outside the database.** Resuming needs Claude or Codex transcript files from the machine that ran the session. Notes, memory and vault live under `~/.thunk`.
3. **Agents need real logins.** Every session spawns `claude` or `codex`, and delivery features call `gh`. Without credentials, the core flow (chat, documents, comments, plans, permissions) can't be exercised. With credentials, every manual test costs money.
4. **Background jobs start on every boot.** The routine scheduler, PR and delivery polling, triage, worker cleanup and file watchers run as soon as the server starts. In a dev checkout they poll GitHub and can fire routines.

What already works anywhere: unit tests (`npm test`) and Playwright (`npm run test:e2e`), which build throwaway projects in a temp folder with memory-only storage. This plan extends that to a running app.

`npm run db:pull` stays as the way to debug with real data on the Mac.

## Scope

### 1. `npm run dev:demo`

Starts `next dev` with:

- `THUNK_DATA_DIR=<repo>/.thunk-demo` (gitignored) and the embedded database there, never `~/.thunk`.
- `THUNK_AGENT=fake` (section 2) and `THUNK_BACKGROUND=off` (section 3).
- Seeding on first start, or when `--reset` deletes `.thunk-demo`.

Seed (`scripts/demo-seed.mjs`, run through the repo functions so it stays valid as the schema changes):

- Two or three projects backed by small real git repos it creates under `.thunk-demo/repos/`: a few commits, two branches, one with uncommitted changes. Real repos mean worktrees, diffs and the file tree all work.
- One repo-less project (plain folder).
- Workspaces: each project's main workspace, plus one worktree workspace.
- Sessions with history: a finished chat with a response document and comment threads, a plan awaiting approval, a session waiting on a permission prompt, a failed turn. Stored as `messages` rows in the same format live sessions persist, so they replay through the normal reducer.
- Tasks in several states, two routines (disabled), a few routine runs, inbox notifications of each urgency, and notes with frontmatter in each notebook scope.
- Deterministic ids and timestamps relative to now, so screenshots and e2e assertions are stable.

The e2e helpers (`e2e/workspace.ts`, `e2e/canvas.ts`) can later reuse the seed instead of building data per test.

### 2. Fake agent driver (`THUNK_AGENT=fake`)

A third driver beside `createClaudeDriver` and `createCodexDriver`, behind the existing `AgentDriver` contract in `lib/agent/session-registry.ts` (`run`, `send`, `interrupt`, `setModel`, `setPermissionMode`, `close`). `createSession` picks it when `THUNK_AGENT=fake`, regardless of model.

Behaviour: each `send` plays a script through `emit`, with realistic delays between events (`turn_start`, `thinking_delta`, `text_delta` chunks, `tool_use`/`tool_result`, `turn_complete` with markdown and a document id, `result` with a small cost). The script is chosen by the prompt:

| Prompt contains | Script |
|---|---|
| (default) | Short streamed answer that becomes a response document |
| `/plan` | `plan_proposed`, then waits for approve or reject |
| `/permission` | `permission_request` for a Bash command, then continues or stops based on the decision |
| `/question` | `ask_question` with options |
| `/edit` | Tool calls that really write a file in the workspace, so diffs and the file tree update |
| `/fail` | Error mid-turn, session goes to `error` |
| `/slow` | Long stream, for testing interrupt |
| a revision payload | Revised document (v2, v3, …) that applies the requested changes as plain edits |

`interrupt` stops the current script and emits the same events as a real interrupt. Resume works because the fake keeps no external state: history replays from the database.

Scripts live in `lib/agent/fake/scripts.ts` as plain data, so new UI states get a script without driver changes. The driver must emit only events the real drivers emit, in valid orders. A contract test runs every script through the session-store reducer and fails on unknown event types or impossible sequences.

Guard: `THUNK_AGENT=fake` logs a banner at startup and shows a "Fake agent" badge in the header, so nobody mistakes it for real.

### 3. Background jobs off (`THUNK_BACKGROUND=off`)

One check in `instrumentation.ts` and in each `ensure*` starter (`ensureScheduler`, `ensureDeliveryPolling`, `ensureTriageScheduler`, `ensureNotificationProducers`, worker cleanup, PR polling). With it off, nothing polls, schedules or fires. **Run now** on a routine still works, using the fake agent.

Default: on in production (`next start`, the desktop app, the server), off for `dev:demo`. A plain `npm run dev` keeps today's behaviour, because it's the closest check of what production does.

Notes file watchers stay on, because they only watch the demo data folder.

### 4. Conductor run script

`thunk.json`:

```json
{ "scripts": { "setup": "npm ci", "run": "npm run dev:demo -- --port $THUNK_PORT" } }
```

Every new workspace opens a working Thunk with demo data. To use the Mac's copied production data instead, run `npm run dev` by hand.

## Order

1. Background switch (small, no dependencies).
2. Fake driver and contract test. This is the largest piece and the most valuable on its own: e2e can start testing chat, documents and plans.
3. Demo seed and `dev:demo`.
4. `thunk.json`, plus a "Develop Thunk" section in the README.

Each step is its own PR.

## Risks

- **Fake drift.** If the real drivers' events change and the fake doesn't, the UI is tested against the wrong shapes. Mitigation: the contract test, and one recorded real transcript replayed in the same test.
- **Demo data drift.** Seeding through repo functions, not SQL, keeps it valid. A unit test runs the seed against an in-memory database.
- **Accidental use in production.** Both switches only change behaviour when explicitly set, and the fake shows a visible badge.

## Out of scope

- A hosted demo instance.
- Faking `gh`. Delivery panels show their "not connected" state in demo mode.
- Copying notes, memory and vault from the server. `db:pull` covers database rows only.
