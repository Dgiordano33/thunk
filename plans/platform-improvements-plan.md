# Platform improvements: review, context, memory and reliability

Status: proposed · Date: 2026-11-27

## Goal

Thirteen improvements from two reviews of Thunk, grouped into five phases. The order puts cheap safety work first, then the storage change that later features depend on, then the three product themes: review with evidence, visible context, and reviewable memory.

Numbers in brackets, such as [3], refer to the original list.

## Phases at a glance

| Phase | Items | What you get | PRs |
|---|---|---|---|
| 0. Safety net | [3] CI, [5] read-only enforcement, [4] backups, [9] limits as settings | A broken PR cannot deploy; read-only sessions cannot write; on-disk data can be restored | 4 small, independent |
| 1. Foundations | [6] orchestration state in Postgres, [8] durable routine triggers, [7] server memory | Plans, queues and routes can be queried and joined to tasks; no trigger is lost on a crash | 6 |
| 2. Review with evidence | [1] review card, [11] completion evidence | "Ready" work has one card: diff, trial merge, criteria, Open PR | 4 |
| 3. Context | [10] Context view, [12] revisions reach the work | You can see and change what an agent was given, and a plan edit reaches its workers | 5 |
| 4. Memory | [13] reviewable Harvest, [2] upkeep routine | Memory changes arrive as small proposals with sources | 3 |

Phase 0 PRs can start now and in parallel. Phase 2 needs the plans and integrations tables from Phase 1. Phases 3 and 4 are independent of each other.

## Phase 0: safety net

### [3] CI on pull requests

Today the only workflow is `desktop-release.yml`, which never runs `typecheck`, `lint` or `npm test`.

1. Add `.github/workflows/ci.yml`, triggered on `pull_request` and on `push` to `main`. One `ubuntu-24.04` job: `actions/setup-node@v4` with Node 24 and `cache: npm` (same as the release workflow), `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`.
2. Add `concurrency` keyed on the ref with `cancel-in-progress: true`.
3. Nothing else is needed on the runner: tests use in-memory PGlite, set their own git identity and stub `gh`.
4. Second job, not required at first: `npm run test:e2e` with `npx playwright install --with-deps chromium`. Make it required once it has been stable for a week.
5. Once the first `ci` run on `main` is green, turn on branch protection for `main` requiring the `ci` check (agreed 2026-11-27).

Not in this PR: making the server deploy only commits whose check passed. Branch protection covers it as long as nobody pushes to `main` directly.

### [5] Enforce read-only sessions

Today `chiefWriteCommand` (`lib/workers/prompt.ts:7-10`) blocks `>`, `tee`, `rm` and `git commit|push`. It misses `git merge`, `gh pr merge`, `sed -i`, `mv`, `cp` and anything in a subshell. Codex sessions never consult it: `lib/agent/codex/driver.ts:411` picks the sandbox from `permissionMode` only.

Claude:

1. New `lib/workers/read-only.ts` with `readOnlyCommand(command): { ok } | { ok: false, reason }`. It replaces the regex with an allowlist.
2. Reject outright: redirection (`>`, `>>`), command substitution (`$(`, backticks), process substitution, `eval`, `xargs`, `sudo`, and `find` with `-delete` or `-exec`.
3. Split the rest on `&&`, `||`, `;` and `|`. Every segment must start with an allowed command:
   - Plain reads: `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `stat`, `file`, `tree`, `pwd`, `which`, `date`, `jq`, `sort`, `uniq`, `cut`, `diff`.
   - `git` with `status`, `log`, `diff`, `show`, `blame`, `rev-parse`, `ls-files`, `branch` (no arguments or `--list`), `worktree list`, `remote -v`.
   - `gh` with `pr view|list|diff|checks|status`, `issue view|list`, `run view|list`, `repo view`.
4. `buildCanUseTool` (`lib/agent/permissions.ts:18-23`) calls it for `readOnlySession` origins and returns the reason, ending with "delegate this to a worker".
5. Tests in `lib/workers/read-only.test.mjs`: every command the old regex missed, plus the read commands chiefs use in existing transcripts so none regress.

Codex:

1. Check the installed app-server's protocol for a read-only sandbox (`sandbox: "read-only"` on `thread/start` and the matching `sandboxPolicy` on `turn/start`). The code only knows `workspace-write` and `danger-full-access` today.
2. If it exists, pass it when `readOnlySession(origin)` is true, in both places (`driver.ts:411` and `:464`).
3. Chiefs write notes and logs through MCP tools that run in the Thunk server, so a read-only sandbox should not break them. Confirm with `tests/chief.test.cjs` and one manual Codex chief run.
4. If the app-server has no read-only mode, set `writableRoots` to an empty list for these roles and keep `networkAccess: false`.

### [4] Back up the files on disk

Today `db:pull` copies Postgres only. Notes, memory, Vault, boards and config under `~/.thunk` have no copy anywhere.

1. `scripts/backup.mjs` and `npm run data:backup`. It writes `<DATA_DIR>/backups/thunk-<iso>.tar.gz` holding:
   - `projects/`, `config/` and `homes/`.
   - `db/<table>.jsonl` for every public table, exported in one repeatable-read transaction. Reuse the cursor code in `scripts/db-pull-core.mjs` so PGlite and external Postgres share one format.
   - `manifest.json`: Thunk version, migration number, file counts.
2. `scripts/restore.mjs` and `npm run data:restore <archive>`. It refuses while `db/thunk.lock` holds a live PID, moves the current data to `<DATA_DIR>.before-restore-<iso>`, then restores files and tables.
3. A daily built-in schedule, like triage: a ticker started from `instrumentation.ts` reads `config/backup.json` (`enabled`, `time`, `keep` default 7, `dir`).
4. Settings → Automation: on/off, time, how many to keep, last backup time and size, "Back up now".
5. Docs: a Backups section in `docs/server.md`.

Archives stay on the machine that runs Thunk (decided 2026-11-27). They protect against a bad write, a bad migration or a deleted project, not against losing the machine itself; `dir` can point at a mounted volume if that changes.

`~/.claude` transcripts are left out by default; `--with-transcripts` adds them. Messages are already in the database, so only resuming an old session depends on them.

The archive includes `config/integrations.json`, which holds tokens. Write archives with mode 0600 and say so in the docs.

### [9] Limits as settings

1. `lib/setup/limits.ts`: reads `config/limits.json` through a zod schema with defaults and clamps.

   | Setting | Default | Range | Replaces |
   |---|---|---|---|
   | Workers per project | 4 | 1–12 | `MAX_WORKERS_PER_PROJECT`, `lib/workers/service.ts:23` |
   | Routine runs at once | 3 | 1–10 | `MAX_CONCURRENT_RUNS`, `lib/routines/types.ts:145` |
   | Relay grace | 5 min | 1–60 | `RELAY_GRACE_MS`, `lib/capture/service.ts:83` |
   | Chief answer wait | 10 min | 1–60 | `CHIEF_ANSWER_MINUTES`, `lib/workers/questions.ts:8` |

2. Replace each constant with a call that reads the setting when it is needed, so a change applies without a restart.
3. `GET/PUT /api/settings/limits` and rows in Settings → Automation, labelled "This server".
4. Prompts that state the worker cap (`teamPrompt`) read the same value.

## Phase 1: foundations

### [6] Orchestration state in Postgres

Today `config/workers/state.json` holds the queue, task stats, races, plans and integrations; `config/routing/state.json` holds route plans and routes; worker reports are one JSON file per session. None can be joined to `tasks` or `sessions`, and the lock is in-process only.

One migration per PR, each following the same three steps: add tables and a repo module in `lib/db/repo/`, import the existing file once on startup inside a transaction and rename it to `state.json.imported`, then switch the callers and delete the file code.

| PR | Tables | Callers switched |
|---|---|---|
| A | `delegation_plans` (id, project_id, chief_session_id, status, note_id, decided_at, note), `delegation_plan_tasks` (plan_id, key, task_id), `integrations` (id, project_id, workspace_id, created_at, merged, conflicts, tests, head_shas) and `integration_tasks` | `lib/workers/plans.ts`, `integrate.ts` |
| B | `worker_queue`, `worker_races` and `task_stats` | `lib/workers/service.ts`, `cleanup.ts`, `lib/capture/service.ts` |
| C | `route_plans` and `routes` | `lib/home/service.ts`, `triage.ts` |
| D | `worker_reports` (session_id, seq, content, chief_session_id, delivered_at) | `lib/workers/report-up.ts` |

PR A comes first because the review card [1] and revision propagation [12] read plans and integration results. `integrations` gains the `merged`, `conflicts` and `tests` details that `workers_integrate` returns today but stores nowhere.

Each `updateWorkerState(fn)` call becomes a transaction over the rows it touches. Existing tests (`tests/chief.test.cjs`, `tests/top-chief.test.cjs`, capture tests) are the regression net; add one import test per PR with a fixture `state.json`.

### [8] Durable routine triggers

Today all three paths advance their cursor before starting the run: cron (`scheduler.ts:30-33`), PR poll (`pr-poll.ts:60-66`) and delivery poll (`delivery-poll.ts:37-38`, which carries a comment asking for exactly this outbox).

1. Migration: `routine_triggers` (id, routine_id, source, dedupe_key unique, payload, status `pending|started|skipped|failed`, attempts, next_attempt_at, run_id, created_at).
2. Each poller inserts a trigger row and advances its cursor (`trigger_state` or `next_run_at`) in one transaction. The dedupe key (for example `pr:<number>:<sha>` or `cron:<routineId>:<nextRunAt>`) makes a repeat insert a no-op.
3. A dispatcher in the scheduler tick takes pending rows that are due, calls `startRun` and stores `run_id`.
4. Outcomes:
   - No free slot, or the routine is already running: stay pending, retry with backoff, give up as `skipped` after an hour. Today this writes a "Skipped" run straight away.
   - Daily cap reached: `skipped` with the reason.
   - `startRun` throws: `attempts + 1`, retry up to three times, then `failed` with an Inbox card.
5. On startup, `reconcile` leaves pending triggers for the dispatcher. A run that was interrupted by the restart is retried once from its trigger when the routine has `catch_up` set; otherwise it stays failed as now.
6. Tests in `tests/routines.test.cjs`: a crash between insert and start, a duplicate poll, a full slot that later frees.

This gives at-least-once starts. It does not make runs resumable mid-way.

### [7] Server memory

Sessions:

1. A session that ends on its own stays in the registry with up to 20,000 events until someone resumes it (`session-registry.ts:188-201`).
2. Add a sweep, on the existing 10-minute cleanup interval: an entry that has been released, has no subscribers and has been idle for 30 minutes is removed with the existing `closeSession` path.
3. Before that, confirm every reader falls back to the database when the entry is missing: the SSE route's `since=` replay, the status endpoints and the session list. `loadEvents` already reads the full history; add the fallback where it is absent.
4. Test: end a session, run the sweep, then open and resume it.

Usage:

1. The endpoint scans every `result` message on every call (`app/api/ambient/usage/route.ts`).
2. Migration: `usage_results` (session_id, seq, workspace_id, project_id, day, cost, token counts; primary key session_id + seq), filled from existing `messages` rows in the same migration.
3. `insertEvents` writes a row when it stores a `result` event.
4. The endpoint sums `usage_results` by day and workspace, and still adds the unflushed tail of live sessions.

## Phase 2: review with evidence

Another session has been changing Inbox grouping and the "work completed / ready for review / merged" states. Build this phase on top of that work once it merges, and reuse its state names.

### [1] A review card in the Inbox

Today a finished worker produces an `info` card with a text block and no actions. The trial-merge result is discarded, and opening a PR means prompting an agent (`components/workspace/pr-button.tsx:46-57`).

1. Migration: add the `review_ready` notification kind.
2. `finishWorker` (`lib/workers/service.ts:328-376`) opens a `review_ready` card with urgency `action` when the outcome is done and the branch has changes. Reports without changes stay as `worker_report` info cards.
3. The card has three parts:
   - **Changes**: summary, diff stat, and "Review diff", which opens `ReviewDiff` for the workspace. "Request changes" sends the review comments to the worker through the existing `SendReview` path.
   - **Trial merge**: the latest `integrations` row that includes the task: merged cleanly, or the conflicting files; tests passed, failed or not run. If the branch head has moved since, it says the result is out of date and offers "Run again".
   - **Pull request**: from `workspacePrStatus`. No PR: "Open PR". Open PR: its checks and a link. Merged: the card resolves.
4. `openPullRequest(workspaceId)` in `lib/projects/github.ts`: pushes the branch and runs `gh pr create` with the title and body taken from the report. `POST /api/workspaces/[id]/pr` calls it. It only ever runs from a person's click.
5. `POST /api/workspaces/[id]/integrate` runs `integrateWorkers` for one task, for the "Run again" button.
6. The existing `pr_merged` delivery event resolves the card (`lib/notifications/delivery.ts:12-19`).
7. Capture cards (`ThoughtReview`) show the same three parts, so a relayed thought and a delegated task read alike.
8. Tests: `tests/notifications` and `tests/chief.test.cjs` for card creation and resolution; a `gh` stub for `openPullRequest`, as `delivery.test.cjs` does.

### [11] Completion with evidence

Today a task has a free-text `body` and nothing describing "done". Reports are free text; nothing separates what an agent says from what Thunk saw.

Criteria:

1. Migration: `tasks.criteria jsonb` (list of `{ id, text, kind }` where kind is `test`, `interaction`, `visual`, `source` or `other`) and `tasks.criteria_version int`.
2. Criteria are optional. The chief's plan tool accepts `criteria` per task, and the prompt tells it to propose them only for substantial work. They are approved with the delegation plan, and editable on the task.
3. The worker prompt lists the criteria and asks for one evidence line per criterion in the `worker-summary` block.

Evidence:

1. Migration: `task_evidence` (id, task_id, criterion_id nullable, origin `observed|claimed`, type `test|ci|merge|preview|screenshot|source|note`, status `pass|fail|unknown`, detail, ref, commit_sha, criteria_version, session_id, created_at).
2. **Claimed** rows come from the worker's report: its test output, a screenshot it saved, source links.
3. **Observed** rows are written by Thunk only:
   - `workers_integrate`: merge and test results.
   - PR checks from `workspacePrStatus`.
   - A preview URL from the delivery poller.
   - Thunk runs `thunk.json` `scripts.test` in the worker's workspace when it finishes. This is a per-project setting, off by default.
4. Every row stores the commit it covers. The card marks a row "covers an older revision" when the workspace head has moved, or when `criteria_version` has changed since.

Review surface: the `review_ready` card gains a criteria table: criterion, evidence, a **Checked** or **Agent says** label, and a link to the output, screenshot or source. Tasks without criteria show the card from [1] unchanged.

## Phase 3: context

### [10] A Context view per session

Today the prompt is assembled when the driver starts (`buildOptions`, `lib/agent/options.ts:86`) and never stored. Truncation is reported only to the agent.

PR 1, record and show:

1. Change `hierarchyPrompt`, `notesPrompt`, `tasksPrompt`, `vaultPrompt` and `renderRoutineContext` to return `{ text, items }`, where each item says what it is and how it was included.
2. Migration: `session_context_items` (session_id, kind `memory|instructions|note|task|vault|routine`, ref_id, title, mode `full|truncated|index|omitted`, chars, content_hash, origin `prompt|fetched|attached`, created_at).
3. Both drivers write the `prompt` items at start and again on resume.
4. `fetched` items: written by the `vault_read` handler, and by the event bridge when a Read tool call targets a path inside the project's notes, memory or vault directories.
5. `GET /api/sessions/[id]/context` returns the items with a `changedSince` flag, computed by comparing each stored hash with the file's current hash.
6. UI: a **Context** tab in `components/workspace/workspace-panel.tsx`, for the active session. Groups: In the prompt, Fetched later, Left out (with the reason: over the 24,000-character limit, not marked to inject, not pinned).

PR 2, change it:

1. **Attach**: pick a note, task or Vault item; Thunk pushes a `<context_attachment>` message into the running session and records an `attached` item.
2. **Send update**: a note that changed since the session got it shows "Changed, not sent". The button pushes a `<note_update>` with a diff, built the way `buildRevisionPayload` does, and records the new hash. The note editor shows the same state for each running session that holds the note.
3. **Remove**: applies from the next start or resume, because the system prompt cannot be changed mid-run. The view says so.

PR 3, saved selections:

1. Migration: `context_sets` (id, project_id, name, notes, task_ids, vault_ids). `RoutineContext` and `ContextPicker` are generalised to it; a routine can point at a set or keep its own list.
2. The new-session dialog and the routine form offer saved sets.

Notes have no version history. This plan uses a content hash and the `updated` stamp as the "version". Full note history is left out.

### [12] Revisions reach the work they change

Today a plan links to tasks one way (`DelegationPlan.taskIds`), tasks carry at most a `note_id`, and a document revision goes only to the session that wrote it.

1. Migration: `task_sources` (task_id, source_kind `document|note`, source_id, version, content_hash, delivered_version). `delegate()` fills it from the plan's `noteId`, and from a new optional `sourceDocumentId` on the chief's delegation tools, defaulting to the chief's latest document.
2. When a linked document gets a revision (`POST /api/documents/[id]/revisions`) or a linked note is saved, find its tasks that are not done.
3. Push a `<source_revision>` message to the project's chief with the diff and those tasks. The chief answers with a new `tasks_revise` tool: per task, a one-line summary of what changed, the new brief, and the new criteria. Tasks it judges unaffected are listed as such.
4. That becomes a `plan_changed` Inbox card (new kind): the diff, the affected tasks, the proposed changes. Approve or edit per task.
5. On approve:
   - The task's body and criteria update, and `criteria_version` goes up.
   - A running worker gets a `<task_update>` message. A queued task simply starts with the new brief.
   - `task_sources.delivered_version` records what the worker has been sent.
6. Worker reports are stamped by Thunk with the source version delivered at report time, shown on the review card as "Implements plan v3". Evidence recorded against older criteria is marked out of date ([11]).
7. Test: the "email notifications → Inbox only" example as a `tests/chief.test.cjs` case.

## Phase 4: memory

### [13] Harvest proposes a reviewable update

Today Harvest appends the workspace log under a dated heading (`lib/projects/harvest.ts:26`). Nothing is replaced, removed or sourced.

1. Migration: `memory_proposals` (id, project_id, status, base_hash, origin, created_at) with items `{ op: add|replace|remove, target, text, kind: decision|workaround, sources, reason }`. `target` is the exact existing text; `sources` are task, session, note or workspace ids.
2. A `memory_propose` tool in the `thunk` MCP server. The Harvest dialog gets "Propose an update", which runs a short read-only session over the workspace memory, the project memory and the workspace's finished tasks and reports. The current append stays as "Add as is".
3. Review screen, opened from a `memory_proposal` Inbox card or the dialog:
   - Each item shows its change, reason, kind and linked sources, with accept, edit and reject.
   - "Edit as document" opens the resulting `MEMORY.md` in the document editor with the changes marked.
   - "Apply" writes through `writeMemory` with the expected-content check. If memory changed since, items are re-matched by `target` and any that no longer match are flagged.
4. `MEMORY.md` stays plain markdown, because Claude's auto-memory reads it directly. Sources and kind go in a sidecar, `memory/sources.json`, keyed by a hash of the entry text. Workarounds get a `reviewAfter` date.

### [2] Memory upkeep routine

1. A built-in routine template, "Memory upkeep", weekly and off by default. Its session reads the whole project memory and the sidecar and calls `memory_propose`.
2. It looks for: duplicates to merge, entries that contradict each other, workarounds past their review date, and entries naming files or commands that no longer exist.
3. The result is the same proposal card as [13], so there is one review flow. A run with nothing to propose resolves quietly.

## Not doing

- A global worker cap across projects, spend budgets, and agent-facing search. They were in the same reviews but not in this list.
- Version history for notes.
- Resuming a routine run mid-way after a crash.
- Automatic PR creation or merging. Open PR is always a click.
- Copying backups off the machine, and a `data:pull` to fetch them to another machine.

## Decisions (2026-11-27)

- **Branch protection** [3]: on, requiring `ci`, once CI is green on `main`.
- **Backups** [4]: kept on the machine that runs Thunk; no off-machine copy.
- **Claude transcripts** [4]: out of the archive by default, behind a flag.
- **Thunk-run tests on finish** [11]: per-project setting, off by default.
- **Plan-change summaries** [12]: the chief writes them.
