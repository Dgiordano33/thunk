# A chief in every project: notes become delegated work

Status: implemented · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-09

## Goal

Inside one project, one session coordinates and the others do the work. You tell the chief what you want, or point it at a note. It turns that into tasks, starts a worker per task in its own worktree, and tells you what happened. Workers report back to the chief, not only to your inbox.

This is the thin slice of `plans/orchestration-plan.md` and `plans/lead-agent-plan.md`, built inside the current model. Where those plans add objects (orchestration rows, lanes, briefs, lead config, a merge gate), this one reuses what exists: the project is the chief's domain, the `main` workspace hosts the chief, worktree workspaces are workers, tasks are the ledger, notes are briefs, and the inbox is where you hear about it. Those plans still describe where this goes next; nothing here blocks them.

What prompted it: [numbrone](https://github.com/stevenmichaelthomas/numbrone), a chief-of-staff agent that routes requests to per-project managers that spawn workers in worktrees. Thunk has the workers, the worktrees, the task files, the inbox and the per-project knowledge. It lacks the two mechanisms that make them a team: an agent that can start another agent, and a report that flows back to the agent that asked.

## Decisions

- **The project is the chief's whole world.** No routing across projects and no global knowledge store. A chief for all projects is later work; a repo-less project (#33) is the natural place for it when it comes.
- **The chief is an ordinary session in `main`, marked by its origin.** No new table or column: the project's chief is the newest session in `main` with `origin.kind = "chief"`. "Open the chief" resumes it, or starts one. "New chief" starts fresh; project and workspace memory carry what matters across chiefs, so a long-lived chief is a convenience, not a requirement.
- **Workers report by push, not by polling.** When a worker settles, Thunk sends its report to the chief as a message and the chief takes a turn. There is no `workers_wait` tool, so no long-running MCP calls and no idle polling turns.
- **The chief does not edit code.** Enforced with `disallowedTools` (`Edit`, `Write`, `NotebookEdit`) on Claude sessions, prompt-only on Codex, and told to use `delegate` instead.
- **A note is a brief.** `delegate` takes a note id; the worker gets the note's text and path, and the task links to the note (`tasks.note_id` exists). The chief can also write the brief inline.
- **The worker lifecycle is the routine runner.** `execute`, `watch` and `finalize` in `lib/routines/runner.ts` already create a worktree workspace, start a session with a prompt, follow it to completion, collect a diff and a PR, and write a report note. They move to a shared module that routines and delegation both call.
- **Nothing merges on its own.** Workers leave branches; you merge with the existing Git controls. Review and gates stay in the lead-agent plan.

## How it reads from the user's side

```
you ──► chief (main workspace)        "ship the onboarding changes in the plan note"
          │  delegate(note) ×3
          ├─► worker A  worktree thunk/onboarding-copy      task A
          ├─► worker B  worktree thunk/onboarding-email     task B
          └─► worker C  worktree thunk/onboarding-metrics   task C
                 │
         <worker_report> ──► chief  ──► "two done, one blocked on a question in your inbox"
```

- The project page gets **Open the chief**. Its session looks like any other, with a `Chief` badge where `Routine · name` shows today.
- Workers appear as workspaces, as they do now, with a `Worker · <task>` badge and the task in the Town hall.
- Your inbox gets one `worker_report` item per finished worker, not a `turn_finished` for every turn. Permission and question prompts from workers reach you as they do today.
- A new project note, `Work log <date>`, is appended as milestones happen (queued, started, blocked, done), and the chief adds outcomes and decisions.

## Phases (each leaves `npm test` green)

### 1. Extract the worker lifecycle (no behaviour change)
- New `lib/workers/`: `start.ts` (create workspace, start session, push the brief), `watch.ts` (the routine `watch` with its status mapping, timeout and finalize hook), `report.ts` (`collectReport` moved from `lib/routines/report.ts`).
- `lib/routines/runner.ts` calls them. `tests/routines.test.cjs` passes unchanged.
- `SessionOrigin` (`lib/routines/types.ts`) moves to `lib/agent/types.ts` and gains `{ kind: "chief" }` and `{ kind: "worker"; chiefSessionId: string | null; taskId: string }`. Badges in `session-header`, `sessions-list` and the field panel key on it like `routine` does.

### 2. The chief
- **Tools**, mounted on the `thunk` MCP server only when `origin.kind === "chief"`, auto-allowed like `tasks_*`:

  | Tool | Does |
  |---|---|
  | `delegate({ taskId? , title?, brief?, noteId?, repoIds?, model?, permissionMode? })` | Creates the task if needed, creates a worktree workspace (`setup: "await"`), starts a worker session with the brief, links `task.sessionId`. Refuses past `MAX_WORKERS_PER_PROJECT` (4) with "wait for a report". |
  | `workers_status()` | Each open task with an owner: status, live state, pending prompts, branch, diff stat, last summary. Computed, no model call. |
  | `workers_message({ taskId, content })` | `pushUserMessage` to the worker; queues if it is mid-turn. |
  | `workers_stop({ taskId, reason })` | Closes the worker session, marks the task `blocked` or `cancelled`. |

- **Report-up** (`lib/workers/report-up.ts`): on a worker's final `result`, build `<worker_report task=… status=done|blocked|failed>` with the summary fence (or last prose), branch, diff stat and workspace link, and `pushUserMessage` it to the chief, resuming the chief session if it is not live. Reports arriving within 20 seconds are batched into one message. A worker that starts waiting on you sends a one-line `<worker_waiting>` so the chief can say so.
- **Chief prompt** (`chiefSystemPrompt`): you coordinate this project and do not edit code; one worker per task; write the brief so a worker with no other context can do it; keep task statuses truthful; when a report arrives, judge it against the task, then either close it, message the worker, or re-delegate; bring the person decisions with a recommendation; log outcomes and decisions in the work log; keep your plan in workspace memory so a new chief can pick it up.
- **Worker prompt**: you are a worker on task X for this project's chief; do only that task; commit on the current branch; do not open a PR unless the brief says so; end with a `worker-summary` fence (`outcome`, `summary`, `branch`, `needs_person?`). Workers get `tasks_*`, `notify` and the vault tools as any session does.
- **Enforcement**: `disallowedTools` for the chief on Claude; `permissions.ts` denies `Bash` commands matching write patterns (`>`, `tee`, `git commit`, `git push`, `rm`) with a message pointing at `delegate`.
- **Inbox**: `lib/notifications/session.ts` suppresses `turn_finished` for workers and emits `worker_report` (info) when one finishes; new kind in `NOTIFICATION_KINDS`.
- **Routes and UI**: `POST /api/projects/[id]/chief` (resume or start), **Open the chief** on the Town center panel, badges from phase 1.
- **Restart**: `instrumentation.ts` reconciles like routines: worker sessions still live re-attach their watchers; finished ones already reported.
- Tests: `tests/chief.test.cjs`: delegate creates task, workspace and session with the right origins; a worker's result reaches the chief as one message; two quick reports batch; cap refuses the fifth worker; stop marks the task; a chief's `Edit` is disallowed.

### 3. Notes as briefs, and delegation without a chief
- `delegate` with `noteId`: the brief is the note's title, body and path, within the existing injected-note budget; `task.noteId` set.
- Note meta bar: **Delegate** starts (or resumes) the chief with "Delegate this note: `<path>`" so you can see it split the work. A note with unchecked checklist items becomes several tasks.
- Task send menu: a **New worktree** destination that runs the worker lifecycle directly, with no chief. It is `POST /api/tasks/[id]/send` with `{ worker: true }`.
- Work log: `lib/workers/log.ts` appends to the project note `Work log <date>` through the notes store; the chief is told its path. Entries: `[chief] queued`, `[worker] done: …`, `[chief] outcome: …`, `[you] decision: …` for inbox answers.
- Tests: note brief round-trip; checklist to tasks; send-to-worktree; log appends.

### 4. Seeing the team
- Town center: a **Chief** section with the chief's last status line, workers running, waiting, done today, and Open the chief.
- Town hall: task rows show the worker badge and link to its workspace; waiting workers sort first.
- Sidebar: workspace rows owned by workers show the worker icon.

## Later (in the existing plans)
- Workers ask the chief before asking you; escalation with a recommendation (lead-agent plan, workstream 3).
- Reviewer sessions and the merge gate (lead-agent plan, workstream 6).
- A chief across projects, in a repo-less project, with per-project chiefs as its managers.
- Watches: a scheduled routine running in `main` with the chief's tools, so Linear or Sentry items become delegated tasks. Needs project connectors (`docs/projects-without-repos-plan.md`, phase 2).
- Cost caps per project across chief and workers.
- Codex chiefs beyond prompt-only enforcement.

## Risks
- **Chief chatter.** Every report is a chief turn. Batching, summaries instead of transcripts, and the worker cap keep it bounded; show the chief's cost on its card.
- **Chief context growth.** A long-lived chief accumulates history. "New chief" plus memory is the release valve; the prompt tells the chief to keep its plan in workspace memory, not in its head.
- **Read-only is not absolute.** `disallowedTools` covers SDK tools; the Bash pattern match has gaps, and `bypassPermissions` bypasses both. Default the chief to `default` permission mode so anything outside the patterns parks as a prompt you see.
- **Worktree setup time.** Each worker runs the project's setup script. `setup: "await"` means `delegate` can take a minute; the tool says so in its result.
- **Restart loses watchers.** Same as routines today; reconcile re-attaches live workers, and a worker that finished while the server was down is detected by the session row's status at startup and reported late.
- **Memory-only mode.** Tasks and sessions vanish on restart without Supabase; the chief resumes through the SDK session file but its workers' tasks are gone. Same caveat the README states for tasks.
- **Notes used as briefs can be long.** The existing budget truncates with a marker; the worker is told the path and can read the rest.

## Sequencing and estimate

| Phase | Estimate | Exit criterion |
|---|---|---|
| 1 | 1–2 days | Routines run through `lib/workers/`; origins render badges |
| 2 | 3–4 days | Chief delegates three tasks, receives three reports, closes two and messages one; survives a restart |
| 3 | 2 days | A plan note with a checklist becomes delegated work; a task can be sent to a fresh worktree without a chief; the work log reads like a day |
| 4 | 1–2 days | Chief card, worker badges, waiting-first ordering |

About two weeks. Phase 2 carries the risk (report-up and enforcement); run a real three-worker delegation before building phase 4.

## Open questions
1. **Where do workers' questions go?** Drafted: to you, as today. Routing them through the chief first is the lead-agent plan's workstream 3.
2. **Should the chief close tasks, or should you?** Drafted: the chief marks `done` when the report matches the task; you can reopen. numbrone leaves "close" to the person.
3. **One chief per project or per workspace?** Drafted: per project, in `main`. Revisit when a project runs two unrelated efforts at once.
4. **Worker model default.** Drafted: the session default model, overridable per `delegate` call.


## Implementation notes

The four phases are implemented. `chief_log` is the additional chief-only tool for note and workspace-memory writes, since Claude chiefs cannot use Edit or Write. Worker results use a durable file outbox and session-message receipts; report delivery may repeat across a crash between dispatch and receipt persistence. Interrupted sessions without a final result are marked blocked rather than silently restarted; message the worker to continue. Workers have a 60-minute timeout.

Supabase installations need migration `0010_worker_reports` to extend the existing notification-kind constraint. No tables or columns were added. Default delegation selects Git repositories only, so plain folders remain outside the worker's workspace.

Validation includes the complete test suite, TypeScript, lint, production build, and an isolated live Claude smoke test: the chief called delegate three times, received three worktree reports in a batch, and accepted all three tasks with tasks_complete. The smoke workers read a fixture file; they did not modify or merge application code.
