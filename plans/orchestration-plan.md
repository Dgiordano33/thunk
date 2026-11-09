# Orchestration: one brief, many workers

Status: proposal · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-08

## Goal

Inside a project, point an agent at a brief made of selected tasks, selected notes, and free text. The agent decomposes the work, dispatches it to worker sessions, one per task, and keeps the tasks current while they run. The UI shows every unit of work as its own lane with live status, what the worker is doing right now, whether it is waiting on a person, what it changed, and what it cost. When the run ends, a report lands in the project notebook and the branches are ready to merge with the existing Git controls.

Non-goals for v1: automatic merging of worker branches, orchestration across projects, direct worker-to-worker messaging, saving a brief as a standing routine, and rendering full nested subagent transcripts. Each is listed under "Later" with the hook it would use.

## Two layers, one product

**Layer 1: show the SDK's own subagents.** The Claude Agent SDK already lets a session fan out with the Agent tool. Thunk currently discards every signal about those children. Making them visible is a small, schema-free change that improves every session, and it de-risks the event-bridge work the second layer builds on.

**Layer 2: orchestration runs.** The feature the goal describes. An orchestrator session receives the brief and dispatches full Thunk sessions as workers, each owning one task and, by default, its own worktree. This is the primary deliverable.

Why Layer 2 is not built on subagents alone:

- Subagents share the parent's working directory. Parallel code changes need separate checkouts, which only workspaces provide.
- Subagents die with the parent, cannot be opened or resumed on their own, and have no checkpoints, diff view, terminal, or PR button. Thunk sessions have all of those.
- The `agents` option and Agent tool are Claude-only. Worker sessions work for Codex too.
- Tasks, routines, and the town map already model exactly the separation the goal asks for. Subagents would hide that work inside one transcript.

## How subagents work (for reference)

A subagent is a child conversation the main agent starts by calling the Agent tool. It runs in the same `claude` process and cwd with its own context window, and optionally its own prompt, model, tool allowlist, and skills (an `AgentDefinition`, passed via the SDK `agents` option or read from the project's `.claude/agents/`). It blocks the parent's tool call until it finishes, or runs in the background and settles later. Its only output to the parent is a text result.

The SDK streams a child's activity as:

- `assistant` / `user` messages with `parent_tool_use_id` set (tool_use and tool_result blocks only, unless `forwardSubagentText` is on).
- `system` messages with subtype `task_started`, `task_progress`, `task_updated`, `task_notification`, keyed by `task_id` and carrying `tool_use_id`, `description`, `subagent_type`, `is_backgrounded`, `spawn_depth`, `parent_task_id`, `last_tool_name`, `usage`, and (with `agentProgressSummaries: true`) a one-line `summary` refreshed about every 30 seconds.
- `background_tasks_changed`: the full set of live background tasks, a level signal to replace rather than pair.

Thunk today: `lib/agent/event-bridge.ts` returns early on any message with `parent_tool_use_id` and ignores every `system` subtype except `init`. A fan-out shows as one "Agent · description" tool row that eventually gets a result.

## Why this is tractable

- **Tasks are already the unit of work.** `tasks` rows carry `session_id` (owner), status, body, note link. `POST /api/tasks/[id]/send` starts a session, claims the task, and pushes the task as the first prompt. That is a one-worker orchestration.
- **Routines already contain the per-worker lifecycle.** `watch()` in `lib/routines/runner.ts` subscribes to a session, maps events to run status including "Needs you", enforces a time limit, and on finish collects a diff stat and PR and writes a report note. `fire()` enforces concurrency and daily limits. `routineSystemPrompt` plus `parseRoutineSummary` give a proven unattended-agent contract.
- **Workspaces are worktrees.** `createWorkspace` makes a branch and worktree, copies `filesToCopy`, and `prepareWorkspace` runs setup. `removeWorkspace` and the `-d` branch cleanup in the routine finalizer already handle "produced nothing".
- **Session provenance exists.** `sessions.origin` is jsonb; `SessionOrigin` is a discriminated union with one member today (`routine`). The header badge, list icon, and field eyebrow already key off it.
- **Agents already talk to Thunk over an in-process MCP server.** `lib/agent/options.ts` mounts `thunk` with the four `tasks_*` tools; `permissions.ts` auto-allows them. Worker tools are more tools on the same server.
- **The UI has the surfaces.** Run status palette and chips (routines), task lists with per-row send menus, workspace tabs, Town hall panel, ambient "Needs attention", sidebar badges, and town fields per session.

## Architecture

```
Brief = selected tasks + selected notes + instructions + options
  │  POST /api/orchestrations
  ▼
orchestrations row ─── orchestrator session (origin.kind = "orchestration", role = "orchestrator")
  │                       runs in the home workspace, edits no code,
  │                       calls mcp__thunk__workers_* tools
  │
  ├─ task A ── worker session A ── workspace A  (worktree thunk/<run>-<task>)
  ├─ task B ── worker session B ── workspace B
  └─ task C ── worker session C ── home workspace (shared, research only)
                     │
          watch() per worker ──► task status, lane state, cost, diff stat
                                 run status, report note, finalize
```

Decision: **one worker session per task, each in its own worktree by default.** Shared-workspace workers are allowed for read-only work but are not the default for repo projects.

Decision: **the orchestrator runs in the workspace the brief was started from and does not edit code.** Its workspace memory directory is the shared board, and its final document is the report. It is an ordinary session, so it can be opened, interrupted, resumed, and messaged like any other.

Decision: **tasks are the ledger.** Lane state is derived from the task's status plus its owner session's live state. No parallel "worker" table.

Decision: **no auto-merge.** Workers leave branches. The run report lists them; the user merges with the existing Merge and Squash controls.

## Workstreams

Ordered by dependency. Each is independently mergeable and leaves `npm run dev` working.

### 1. Subagent visibility (Layer 1)

Make the SDK's children show up in the session view with live progress.

- `lib/agent/types.ts`: add events
  - `subtask_started { taskId, toolUseId?, description, subagentType?, background, depth, parentTaskId? }`
  - `subtask_progress { taskId, lastTool?, summary?, usage: { tokens, toolUses, durationMs } }`
  - `subtask_tool { taskId, parentToolUseId, toolUseId, name, input }` (last tool only is kept client-side; the event is small)
  - `subtask_finished { taskId, status: "completed" | "failed" | "stopped", summary, usage? }`
- `lib/agent/event-bridge.ts`: handle `system` subtypes `task_started`, `task_progress`, `task_updated`, `task_notification`; skip entries with `skip_transcript` or `ambient`. For `assistant` messages with `parent_tool_use_id`, emit `subtask_tool` for tool_use blocks instead of returning. Keep ignoring parent-tagged `stream_event` and `user` messages in v1 (`forwardSubagentText` stays off; transcript stays light).
- `lib/agent/options.ts`: `agentProgressSummaries: true`.
- `lib/store/session-store.ts`: `subtasks: Record<taskId, Subtask>` plus `subtaskByToolUse` so the Agent tool call row can find its lane. Reduce the four events; persisted events replay through the same reducer, so reload restores lanes.
- `components/chat/subagent-card.tsx`: rendered inside the Agent/Task tool row in place of the raw input: description, status dot in the routine palette (amber pulse running, emerald completed, red failed, muted stopped), `summary`, last tool via `toolSummary`, tokens and duration in `tabular-nums`. A "Workers · N running" chip in `session-header.tsx` while any subtask is live.
- `lib/agent/persist.ts`: nothing to change; `insertEvents` stores events as-is. `tool_calls` is untouched.
- Codex: no equivalent signal from `codex app-server`; the events simply never fire.

Acceptance: ask a session to research two things in parallel with subagents. Two cards show live summaries and last tools, finish with summaries, and survive a page reload. A background subagent shows as running after the parent's turn completes and settles later.

### 2. Data model and API

- Migration `0005_orchestrations.sql`:
  - `orchestrations`: `id`, `project_id`, `workspace_id` (home), `session_id` (orchestrator, nullable until started), `title`, `status` (same six values as `routine_runs`), `brief jsonb` (`{ taskIds, notes: [{scope, id}], instructions, options }`), `max_parallel int default 3`, `max_worker_minutes int default 60`, `cost_cap_usd numeric null`, `cost_usd numeric default 0`, `summary text`, `note_id text`, `error text`, `started_at`, `finished_at`, `created_at`, `updated_at`; indexes on `(project_id, created_at desc)` and open status.
  - `alter table tasks add column orchestration_id uuid references orchestrations on delete set null;` plus a partial index. Tasks keep their own owner session; the run id groups them.
  - RLS and `set_updated_at` trigger like 0003.
- `lib/routines/types.ts` → `SessionOrigin` becomes `RoutineOrigin | OrchestrationOrigin` where `OrchestrationOrigin = { kind: "orchestration"; orchestrationId; title; role: "orchestrator" | "worker"; taskId?: string }`. Move the type to `lib/agent/types.ts` since two features share it; keep a re-export.
- `lib/orchestration/types.ts` (client-safe): `Orchestration`, `OrchestrationBrief`, `OrchestrationOptions` (`workerModel`, `workerPermissionMode`, `isolation: "worktree" | "shared"`, `maxParallel`, `maxWorkerMinutes`, `costCapUsd`), `Lane` (task + owner session meta + live state + diff stat), `OrchestrationDetail = Orchestration & { lanes: Lane[]; orchestrator: SessionMeta | null }`, status labels (reuse `RUN_STATUS_LABELS`).
- `lib/orchestration/schema.ts`: zod for the create body and options. Notes are referenced by scope and id, resolved server-side through `dirsForScope` so the brief never embeds paths from the client.
- `lib/supabase/repo/orchestrations.ts`: insert, get, list by project, update, plus the memory fallback the other repos have. The desktop plan's SQLite port must include this table; keep every read and write behind the repo boundary.
- Routes:
  - `GET/POST /api/orchestrations?projectId=` (list with lane summaries; create and start)
  - `GET /api/orchestrations/[id]` → `OrchestrationDetail`, composed from the row, `listTasks({ orchestrationId })`, and live session metas with pending counts (same shape the ambient activity route builds)
  - `DELETE /api/orchestrations/[id]` → cancel: stop workers, close orchestrator, mark cancelled
  - `POST /api/orchestrations/[id]/retry { taskId }` → respawn one lane and tell the orchestrator (workstream 6)
- `lib/client/api.ts`: `listOrchestrations`, `createOrchestration`, `getOrchestration`, `cancelOrchestration`, `retryLane`.

Acceptance: `POST` with two task ids and one note creates a row, starts an orchestrator session with the right origin, and `GET` returns two lanes in `open`.

### 3. Orchestrator session and worker tools

The core. `lib/orchestration/` mirrors `lib/routines/`: `prompt.ts` (client-safe), `runner.ts`, `report.ts`, `state.ts`.

**Brief rendering** (`renderBrief`, `prompt.ts`): a markdown message with sections "Tasks" (id prefix, title, body, current status, scope), "Notes" (full text per note under its title and path, truncated as a whole at the existing 24k note budget with a visible marker), "Instructions", and "Constraints" (max parallel, isolation, time limit, cost cap). Note contents are inlined so the orchestrator does not have to read files to start.

**Orchestrator system prompt** (`orchestrationSystemPrompt`, appended like `routineSystemPrompt`):

- You coordinate; you do not edit code or run the project yourself. Reading files to plan is fine.
- One worker per task. Start independent tasks in parallel up to the limit; sequence dependent ones and pass the earlier result forward in the later worker's instructions.
- After spawning, wait with `workers_wait`, read the summaries, then decide: done, message the worker with a correction, respawn with better instructions, or mark the task blocked with a reason. Keep task statuses truthful at all times.
- When a worker needs a person, say so in your next message and keep going with the others.
- Ask the user only if continuing would be unsafe. Do not force-push, rewrite history, or delete branches you did not create.
- End with one fenced `orchestration-summary` block: `outcome`, `summary`, and one `task:` line per task with `<id> · <outcome> · <workspace or none> · <one line>`.

**Worker system prompt** (`workerSystemPrompt`): you are a worker in run X for task Y; do exactly that task; do not claim other tasks; commit on the current branch with clear messages; do not open a PR unless told; shared-workspace workers must not edit files; end with one fenced `worker-summary` block (`outcome: ok | changes | nothing | blocked`, `summary`, `pr`). `parseRoutineSummary` is generalized to take the fence name.

**Tools**, added to the `thunk` MCP server in `options.ts` only when `live.meta.origin?.kind === "orchestration" && role === "orchestrator"`, and auto-allowed in `permissions.ts` like `tasks_*`:

| Tool | Input | Behavior |
|---|---|---|
| `workers_spawn` | `taskId`, `instructions?`, `isolation?`, `model?`, `permissionMode?`, `title?` | Rejects if the run is at `maxParallel` (tells the agent to `workers_wait`). For `worktree`: `createWorkspace({ name: "<run-slug>-<task-prefix>", setup: "await" })`; for `shared`: the home workspace. `startSession` with worker origin, `upsertSession`, `patchTask` to `in_progress` with `sessionId` and `orchestration_id`, push the worker prompt (task title and body, the orchestrator's instructions, relevant brief excerpt), register the lane watcher. Returns the lane. |
| `workers_status` | none | Every lane: task id and title, status, session id, live state, pending request count, last tool line, cost, diff stat, finished summary. |
| `workers_wait` | `taskIds?`, `mode: "any" \| "all"`, `timeoutSeconds` (max 600) | Resolves when a listed worker finishes, when one starts waiting on a person, or at the timeout with `stillRunning: true`. Returns the summaries that arrived. Chunked so a single MCP call never runs for an hour. |
| `workers_message` | `taskId`, `content` | `pushUserMessage` to the worker (queues if it is mid-turn). |
| `workers_stop` | `taskId`, `reason`, `markAs: "blocked" \| "cancelled"` | `closeSession` on the worker, patch the task, record the reason. |

**Lane watcher** (`watchWorker` in `runner.ts`, adapted from the routine `watch`): `turn_complete` keeps the last markdown; `result` with nothing pending parses `worker-summary`, collects the diff stat for that workspace, sets the task to `done` (or `blocked` for `blocked`), adds cost; `status: awaiting` flags the lane as needing attention; `error` and `closed` set `blocked` with the message; a timer at `maxWorkerMinutes` interrupts and marks `blocked: timed out`. Each settle resolves any pending `workers_wait`.

**Run watcher** on the orchestrator: `awaiting` → run `needs_attention`; `result` after the final document → `finalize`; `error`/`closed` → `failed`/`cancelled`. The run stays `running` while any lane is still live even if the orchestrator's turn ends; a background `workers_wait` from the agent is the expected pattern, and the finalizer also fires when the last lane settles after the orchestrator has already reported.

**Guardrails**: `maxParallel` per run (default 3); `MAX_CONCURRENT_WORKERS = 6` across runs, checked in `workers_spawn`; `maxWorkerMinutes` per lane; `costCapUsd` checked on every `result`, interrupting all workers and failing the run with "cost cap reached" when exceeded. Startup reconcile (from `instrumentation.ts`, next to the routines one) marks runs still open at the last shutdown as `failed: interrupted` and leaves their tasks as they are; the user can resume the orchestrator session and it learns from `workers_status` which lanes are gone.

**Memory and shared state**: workers in separate worktrees have separate workspace memory. The orchestrator writes `progress.md` in the home workspace notebook (one line per lane, updated on every settle by the runner, not the model) and workers are told its path so they can read context left by earlier lanes.

Acceptance: a brief with three independent tasks produces three worktrees and three worker sessions; the orchestrator waits, reads three summaries, marks the tasks done, and ends with a parsable summary; the run row shows cost, the tasks show owners, and the report note exists. A brief with one task that depends on another runs them in sequence.

### 4. Brief composer and selection

- **Tasks multi-select.** `task-list.tsx` and `task-row.tsx` get a selection mode: a checkbox appears on hover and stays once any row is selected; shift-click ranges; a sticky bar at the top of `TaskBoard` reads "N selected · Orchestrate · Send to… · Clear". Works in the workspace Tasks tab and the Town hall. Done or cancelled tasks are excluded from orchestration with a hint.
- **From a note.** `note-meta-bar.tsx` gets "Orchestrate from note", which opens the brief sheet with the note attached and, if the note has unchecked checklist items, offers to import them as tasks first (reusing `noteImportCandidates`).
- **Brief sheet** (`components/orchestration/brief-sheet.tsx`, a wide `Sheet` like `TaskSheet`): attached tasks (removable; "Add task…" opens a searchable list via `cmdk`), attached notes (a two-notebook picker showing each note's size; memory notes are already injected and are not offered), instructions textarea with the same `@` completion as the composer, and options: worker model (`ModelSelect`), worker permission mode (default `acceptEdits`), isolation (default "worktree per task" for repo projects, "share this workspace" for folder projects and forced for them), max parallel, time limit, optional cost cap. A footer shows the estimated brief size and warns when note text will be truncated. Submit calls `createOrchestration` and navigates to the run.
- **Composer mention (stretch).** `prompt-context` route also returns open tasks; `prompt-composer.tsx` offers `task:<title>` under `@` and inserts `task:<8-char id>`. Useful for talking to a live orchestrator ("also handle @task:abc12345").

Acceptance: select three tasks in the Town hall, attach a note, pick Sonnet for workers, submit, land on the run view with three lanes.

### 5. Run view and progress

- **Run panel** (`components/orchestration/run-panel.tsx`): header with title, status chip (routine palette), elapsed, cost, lane count, Cancel; one lane per task: title, task status chip, owner session link, live activity line (the worker's last `tool_use` through `toolSummary`, or "Waiting for you" in amber with an Open link, or the finished summary's first line), diff stat, cost; a footer that renders the orchestrator's final document with `DocumentCard` when the run is finished, and an "Open orchestrator" link always.
- **Feed.** `GET /api/orchestrations/[id]` polled every 3 seconds while the panel is mounted, plus the existing tasks SSE for immediate status flips. Live activity lines come from a small `lastActivity` map the server keeps per live session (updated in the lane watcher from `tool_use` events), exposed on the detail response. No new SSE endpoint in v1.
- **Placement.** Workspace page: a "Runs" tab beside Sessions, Notes, Tasks (`?tab=runs`), listing runs started from or touching this workspace, opening the panel inline. Town hall: a "Runs" section above the task lists with active runs first, each row showing mini lane dots; clicking opens the run in the same `TownPanel`. The list view reuses `routine-list.tsx` conventions.
- **Session surfaces.** `session-header.tsx` shows "Orchestrator · <run>" or "Worker · <run> · <task>" from the origin, the way "Routine · <name>" shows today. `sessions-list.tsx` and the field panel eyebrow get the same treatment. Town fields for workers in a run share a small banner mark so they read as one group on the map.
- **Attention.** `ambient-hub.tsx` "Needs attention" rows include the run title for worker sessions. Sidebar workspace badges count lanes waiting on a person.

Acceptance: with three workers running, the panel shows three distinct activity lines updating within a few seconds; approving a worker's permission from its session clears the amber state in the panel; cancelling the run stops all three and marks tasks blocked.

### 6. Report, integration, retry, cleanup

- `lib/orchestration/report.ts`: on finalize, parse `orchestration-summary`, merge per-lane results, write a note to the project notebook with a table of lanes (task, outcome, workspace and branch, diff stat, PR, cost) and the summary, and link it from the run (`note_id`) and from each task's body as a one-line "Done in run <title>" footer.
- **Integrate section** in the run panel after finish: per worker worktree with commits, the branch name, diff stat, and a link to that workspace's Git controls (Merge, Squash, Sync, Rebase already exist). For worktrees with no changes, "Remove workspace" reuses `removeWorkspace` and the `-d` branch drop from the routine finalizer. Nothing is merged automatically.
- **Retry a lane**: `POST /api/orchestrations/[id]/retry` respawns a worker for a blocked or failed task with the original instructions, re-registers the watcher, flips the run back to `running`, and messages the orchestrator so it can wait on it. If the orchestrator session has ended, the lane still runs and the finalizer reruns on settle.
- **Cancel** stops workers first, then the orchestrator; tasks in progress become `blocked: run cancelled`.

Acceptance: a finished run has a report note, an Integrate list with correct branches, and a retry of a blocked lane completes and updates the report.

### 7. Later

- Save a brief as a routine: `routines.prompt` becomes a brief; a routine run creates an orchestration. The runner split in workstream 3 keeps this to a thin adapter.
- Forward subagent transcripts (`forwardSubagentText: true`) behind an expander on the subagent card, with the parent-tagged `stream_event` handling the bridge currently skips.
- Dependency declarations in `workers_spawn` (`after: [taskId]`) so the runner, not the model, sequences lanes.
- Nested lanes: a worker's own SDK subagents (Layer 1) shown under its lane.
- A dedicated town building for runs if the Town hall gets crowded.

## Changes to existing code (summary)

| File | Change |
|---|---|
| `lib/agent/types.ts` | `subtask_*` events; `SessionOrigin` union with `OrchestrationOrigin` |
| `lib/agent/event-bridge.ts` | Handle task system subtypes and parent-tagged tool_use blocks |
| `lib/agent/options.ts` | `agentProgressSummaries: true`; mount `workers_*` tools for orchestrator sessions; append orchestrator/worker prompts by origin |
| `lib/agent/permissions.ts` | Auto-allow `workers_*` like `tasks_*` |
| `lib/agent/session-registry.ts` | Track `lastActivity` per live session for lane lines |
| `lib/store/session-store.ts` | `subtasks` state and reducers |
| `lib/routines/prompt.ts` | Generalize summary-fence parsing by fence name |
| `lib/routines/types.ts` | Re-export `SessionOrigin` from agent types |
| `lib/tasks/types.ts`, `schema.ts`, `repo/tasks.ts` | `orchestrationId` field and filter |
| `components/chat/tool-call.tsx` | Render `SubagentCard` for Agent/Task rows |
| `components/session/session-header.tsx`, `workspace/sessions-list.tsx`, `town/*` | Origin badges for orchestrator and worker |
| `components/tasks/task-list.tsx`, `task-row.tsx`, `task-board.tsx` | Selection mode and action bar |
| `components/notes/note-meta-bar.tsx` | "Orchestrate from note" |
| `components/workspace/workspace-tabs.tsx`, `workspace-shell.tsx` | Runs tab |
| `components/town/tasks-panel.tsx` | Runs section |
| `components/ambient/ambient-hub.tsx` | Run title on attention rows |
| `components/chat/prompt-composer.tsx`, `app/api/workspaces/[id]/prompt-context` | `@task:` mentions (stretch) |
| `instrumentation.ts` | Orchestration reconcile on start |
| `lib/client/api.ts` | Orchestration calls |
| `README.md` | Orchestration section and API list |
| new `supabase/migrations/0005_orchestrations.sql` | Table and task column |
| new `lib/orchestration/{types,schema,prompt,runner,report,state,tools}.ts` | Feature |
| new `lib/supabase/repo/orchestrations.ts` | Persistence with memory fallback |
| new `app/api/orchestrations/**` | Routes |
| new `components/orchestration/{brief-sheet,run-panel,run-list,lane}.tsx`, `components/chat/subagent-card.tsx` | UI |
| new `tests/orchestration.test.cjs` | Runner, tools, prompt parsing, reconcile |

## Risks

- **Long-running MCP tool calls.** `workers_wait` must return within the SDK's tool timeout. Cap at 10 minutes and return `stillRunning`, with the prompt telling the orchestrator to call again. Measure the real timeout on day one of workstream 3.
- **Orchestrator cost from polling.** Every `workers_wait` return is a model turn. Long waits, summaries only (never transcripts) into the orchestrator, and the run cost cap keep this bounded. Show orchestrator cost separately in the panel so it is visible.
- **Worktree setup time and disk.** Each worker worktree runs the project's setup script. Three workers can mean three installs. `workers_spawn` awaits setup so a worker never starts on a half-installed tree; the lane shows "Setting up" meanwhile. Offer reuse of idle existing workspaces later.
- **Shared-workspace collisions.** Two workers editing one checkout collide on files and on the per-workspace checkpoint lock. Shared mode is read-only by prompt in v1, not enforced; the brief sheet defaults repo projects to worktrees and says why.
- **Permission storms.** Five workers in `default` mode means five parallel prompts. Default workers to `acceptEdits`; route everything through the existing attention list; show the lane amber.
- **Restart loses watchers.** Lane and run watchers are in-process like routine runs. Reconcile marks runs interrupted; sessions themselves are resumable, so no work is lost, only the automation around it.
- **Memory-only mode.** Without Supabase, orchestrations live in server memory like tasks and vanish on restart. Same caveat the README already states for tasks.
- **Codex as orchestrator.** The Codex driver already mounts the `thunk` tools, so `workers_*` should work, but the behavior of long tool calls in `codex app-server` is untested. Treat Codex orchestrators as experimental until tested; Codex workers are fine.
- **Summary fences.** Models sometimes omit or malform the fence. The parser falls back to the last prose, as the routine parser does, and the lane shows "unparsed" rather than failing the run.

## Sequencing and estimate

| Phase | Workstreams | Estimate | Exit criterion |
|---|---|---|---|
| A | 1 | 1–2 days | Subagent cards with live summaries in any session; survives reload |
| B | 2, 3 | 4–5 days | A brief posted by `curl` runs three workers in three worktrees to completion with a report note |
| C | 4, 5 | 3–4 days | Multi-select → brief sheet → run panel with live lanes; origin badges everywhere |
| D | 6 | 2 days | Integrate list, retry, cancel, reconcile, tests, README |

Roughly two and a half weeks of focused work. Phase A stands on its own and should ship first. Phase B is the risk-bearing phase; do the `workers_wait` timeout check and a real three-worktree run before building any UI on top.

## Open questions

1. **Name and town metaphor.** "Orchestration" and "run" are used here. A game-flavored name and a building (the Town hall for now) can be decided when the panel exists. Recommendation: ship under the Town hall, rename later if it earns a building.
2. **Default worker model.** Inherit the orchestrator's model, or default to a cheaper one? Recommendation: default to the session default model, make it one click to switch all workers to Sonnet in the brief sheet.
3. **Shared workspace edits.** Enforce read-only for shared-mode workers (deny Edit/Write via `disallowedTools` on the session) or leave it to the prompt? Recommendation: prompt only in v1, enforce in v2 once the SDK path for per-session tool denial is confirmed.
4. **Orchestrator location.** Home workspace (recommended, no code edits, shared board in its notebook) versus a fresh worktree per run (cleaner cleanup, no board). Revisit if orchestrators start editing code despite the prompt.
5. **Global concurrency.** Routines cap at 3 runs; this plan caps workers at 6 across runs. Should there be one global live-session ceiling shared by people, routines, and workers? Probably yes once the desktop app ships and the machine is the bottleneck.
