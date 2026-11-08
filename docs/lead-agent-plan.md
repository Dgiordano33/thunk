# Lead agents: a manager for your coding agents

Status: proposal · Author: Dan Giordano (drafted with Claude Code) · Date: 2026-11-08

## Goal

Every project gets a lead agent. It keeps the plan, remembers decisions, delegates work to worker sessions, knows what is stuck, and brings you only the things that need your judgment. Workers show what they made. Everything that needs you lands in one queue, your answer flows back to the agent that asked, and feedback stays open until the agent has addressed it. Risky changes are tested and reviewed before they land.

In the words of the workflow this plan targets:

1. Give each project a lead agent. It keeps the plan, remembers decisions, delegates work and knows what's stuck.
2. Let it start other agents for specific tasks. They work in parallel, bring questions to the lead and report back.
3. Have agents show what they made: screenshots, live pages, different options and what changed since the last round.
4. Put everything that needs your judgment in one queue. Point at what needs changing, give feedback or approve the work. Your response goes back to the agent.
5. Keep feedback open until it's addressed. Test changes before they land, get a second opinion on merges and approve anything risky.

Thunk has the foundations for four of the five. This plan turns them into one workflow. It builds on `docs/orchestration-plan.md` (briefs, workers, lanes) and `docs/repo-notes-plan.md` (plans and boards in the repo). Where this plan and the orchestration plan overlap, this plan wins; the differences are called out.

Non-goals for v1: auto-merge without a person, lead-to-lead coordination across projects, workers starting their own workers, and replacing GitHub review with Thunk review. Each is under "Later".

## What exists today, mapped to the five points

| Point | Have | Missing |
|---|---|---|
| 1. Lead | Project memory, repo notebooks (plans, boards), tasks with owners, routines as standing orders | A standing lead session with the authority and tools to delegate; a decisions log it maintains; a "what's stuck" view it owns |
| 2. Workers | `POST /api/tasks/[id]/send` starts one worker in a worktree; routine `watch()` is the per-worker lifecycle; the `thunk` MCP server mounts tools per session | Spawn from an agent; questions routed to the lead first; report back as structured summaries (orchestration plan workstream 3) |
| 3. Show work | Dev-server preview, diff view, checkpoints, document versions v1..vN, Delivery section with PR and checks | Agent-made screenshots and attachments; "since your last review" diffs; side-by-side options |
| 4. One queue | Permission cards, `AskUserQuestion` forms, plan approve/request changes, routine runs parked as *Needs you*, the ambient hub's activity feed | A single inbox across projects with every item type, including review requests and merge approvals; answers that route back by item |
| 5. Feedback loop | Comments as marks that move with edits, `open`/`resolved` status, `<document_revision>` payloads | Comments on code and files (not only documents); agent-resolved threads with evidence; a pre-merge gate: tests, second-opinion review, risk flags |

## Decisions

Decision: **the lead is a standing session per project, not a per-run orchestrator.** The orchestration plan creates an orchestrator for each brief. Here, one lead session per project lives in the project's `main` workspace, resumes across restarts via the SDK `resume`, and runs briefs itself. Briefs become messages to the lead rather than a separate object. The orchestration row, lanes, worker tools, and run panel from the orchestration plan all stay; `orchestrations.session_id` points at the lead.

Decision: **the lead edits context, never code.** The lead owns the plan note, the decisions log, task statuses, and the board. It reads code to plan. Enforce with `disallowedTools` for `Edit`, `Write`, `NotebookEdit` and `Bash` write patterns on the lead session, not only by prompt.

Decision: **the plan and the decisions log are notes, and the repo copy wins when it exists.** If the project has a repo notebook registered for `.claude/plans` the lead writes there; otherwise it writes to the project notebook. The decisions log is `decisions.md` in the same notebook, append-only by convention, injected into every session in the project.

Decision: **workers ask the lead first.** A worker's `AskUserQuestion` goes to the lead, which answers from the plan and decisions log or escalates to you with its own recommendation attached. Permissions and plan approvals still go to you directly; the lead cannot grant permissions.

Decision: **one inbox, typed items, answers routed by item.** A new `attention` feed unifies today's parked requests with review requests, merge approvals, and lead escalations. Every item carries the session and request it came from, so an answer in the inbox is the same `POST` the session page would make.

Decision: **feedback is a thread with a resolver.** A comment opens a thread that only the addressed agent can mark resolved, and it must cite what it changed (a commit, a document version, or a file). You can reopen. Threads attach to documents (today), to files in a workspace diff (new), and to screenshots (new).

Decision: **merging is gated, not automated.** Before a worker branch can be merged from Thunk, the gate requires: the workspace's Run or test script exited zero on the current head, a reviewer session (another agent) posted a verdict, every open thread on the branch is resolved, and any `risk` label the reviewer applied has your explicit approval. The Merge button shows which conditions are unmet. GitHub remains the place for merges that happen outside Thunk.

## Architecture

```
project ── lead session (origin.kind = "lead", main workspace, resumable)
   │          owns: plan note · decisions.md · tasks · board
   │          tools: workers_* · tasks_* · review_request · attention_escalate
   │
   ├─ worker A ── worktree A ── artifacts (screenshots, pages) ── threads
   ├─ worker B ── worktree B ── …
   │        └── AskUserQuestion ──► lead answers, or escalates ──► inbox
   │
   ├─ reviewer session (origin.kind = "reviewer", read-only on branch) ──► verdict + risk labels
   │
   └─ inbox ◄── permissions · questions · plans · escalations · review requests · merge approvals
         └── answer ──► the session and request it came from
```

## Workstreams

Ordered by dependency. Each is independently mergeable and leaves the test suites green.

### 1. Subagent visibility and worker tools (from the orchestration plan)

Prerequisite, unchanged: orchestration plan workstreams 1, 2, and 3 (subagent cards, `orchestrations` table and lanes, `workers_spawn / status / wait / message / stop`, lane and run watchers, summary fences). Two amendments:

- `OrchestrationOrigin.role` gains `"lead"` and `"reviewer"` alongside `"orchestrator"` and `"worker"`. `"orchestrator"` stays for one-off briefs started without a lead.
- `workers_spawn` accepts `askLeadFirst: boolean` (default true when spawned by a lead). It sets a per-session flag the permission layer reads in workstream 3.

Acceptance: as in the orchestration plan. A brief run by hand produces three worktrees and a report note.

### 2. The lead session

- Migration `0008_leads.sql`: `projects.lead_session_id uuid null references sessions on delete set null`, `projects.lead_config jsonb` (`{ model, permissionMode, plansScope: NoteScope | null, maxParallel, costCapUsdPerDay }`).
- `lib/lead/` mirrors `lib/routines/`: `types.ts` and `schema.ts` (client-safe), `prompt.ts`, `service.ts` (ensure, resume, message, stop), `state.ts` (what's stuck, computed).
- **Ensure**: `ensureLead(projectId)` returns the live lead session, resuming it with the SDK `resume` id from `sessions` if it is not live, or creating it in the `main` workspace with origin `{ kind: "orchestration", role: "lead", orchestrationId: null }`. One per project, enforced by the column.
- **System prompt** (`leadSystemPrompt`): you are the lead for this project; you keep `<plan path>` and `<decisions path>` current; you never edit code; you delegate with `workers_spawn`, one task per worker; you answer worker questions from the plan and log; you escalate to the person with `attention_escalate` only with a recommendation attached; when a lane finishes you verify the summary against the task, update the board, and request a review with `review_request` before suggesting a merge; you end each turn with a short status (`lead-status` fence: `stuck`, `waiting_on_person`, `running`, `next`).
- **Enforcement**: `disallowedTools: ["Edit", "Write", "NotebookEdit"]` on the lead's `query()` options, plus a `canUseTool` rule that denies `Bash` commands matching write patterns (`>`, `tee`, `git commit`, `git push`, `rm`) with a message pointing at `workers_spawn`. Reads, `git log`, `git diff`, and tests are allowed.
- **Context**: the lead's system prompt injects the plan note and `decisions.md` in full (own budget, 32k, separate from the 24k notes budget), the open task list with owners and ages, and the lanes from `workers_status`.
- **Decisions log**: a `decisions_record` tool (`{ decision, why, alternatives?, taskIds? }`) appends a dated entry to `decisions.md` through the notes store so frontmatter and watchers behave. Workers get `decisions.md` injected too, so decisions propagate without the lead repeating them.
- **What's stuck** (`leadState(projectId)` in `state.ts`, no model call): tasks `blocked` or `in_progress` with no owner activity for N minutes, lanes `awaiting` a person, threads open longer than N hours, branches with failing checks. Rendered in the project page and used by the lead's own status.
- **Routes**: `GET/POST /api/projects/[id]/lead` (state, ensure or configure), `POST …/lead/message` (`{ content, taskIds?, noteRefs? }`, the brief composer posts here), `POST …/lead/stop`.
- **Daily cost cap** per project across lead, workers, and reviewers, enforced in `workers_spawn` and on every `result` event; the lead is told when it is near the cap.

Acceptance: open a project, click "Start lead", send "plan the next three tasks and get them going"; the lead writes the plan note, records a decision, spawns three workers, and its status line reads `running`. Restart the server; the lead resumes with its history and `workers_status` shows the surviving lanes.

### 3. Questions route to the lead

- `lib/agent/permissions.ts`: when a worker session has `askLeadFirst` and the parked call is `AskUserQuestion`, do not create a person-facing request. Instead post the question to the lead (`pushUserMessage` with a `<worker_question taskId=… sessionId=…>` envelope) and park the worker call keyed by a `questionId`.
- New lead tool `workers_answer({ questionId, answer })` resolves the parked call with the answer, exactly as the UI's answer `POST` does today. New lead tool `attention_escalate({ questionId?, summary, recommendation, options? })` creates an inbox item of kind `escalation` (workstream 5) and marks the worker lane `awaiting`.
- Timeout: if the lead does not answer within 10 minutes (configurable), the question escalates automatically with "lead did not answer" so a worker is never stuck on a silent lead.
- Permissions (`canUseTool` for tools), `ExitPlanMode`, and anything in `default` permission mode still go to the person. The lead is told in its prompt that it cannot grant these.

Acceptance: a worker asks "Postgres or SQLite for this cache?"; the lead answers from `decisions.md` without the person seeing a prompt; the exchange shows in the worker's transcript and in the lane's activity line. A question outside the plan arrives in the inbox with the lead's recommendation.

### 4. Show your work: artifacts and rounds

- **Artifacts table**: migration `0009_artifacts.sql`: `artifacts` (`id`, `workspace_id`, `session_id`, `task_id null`, `kind: screenshot | page | file | diff | note`, `title`, `path` (under `~/.thunk/projects/<slug>/workspaces/<slug>/artifacts/`), `url null`, `meta jsonb` (viewport, route, checkpoint head, option label), `round int`, `created_at`). The existing `Artifact` type in `lib/documents/types.ts` (document list rows) is renamed `DocumentArtifact` to free the name.
- **Worker tools** on the `thunk` server for worker and plain sessions: `artifact_screenshot({ url | route, viewport?, label?, fullPage? })` drives the pre-installed Playwright against the workspace's dev server (starting it with the Run script if it is not up, as the preview does), saves a PNG, records a row, returns the path and a Thunk URL; `artifact_add({ path | url, kind, title, label? })` registers an existing file or live page; `artifact_options({ label, artifacts: [...] })` groups several artifacts as alternatives for one decision.
- **Rounds**: a round is one review cycle. `review_round` on the workspace increments when the person submits feedback (workstream 6) or approves. Each artifact and each checkpoint carries the round. "What changed since the last round" is the diff from the checkpoint captured at the end of the previous round to the current head, using `captureWorkspaceCheckpoint` with label `round-N`; `diff.ts` already renders it.
- **Prompt**: worker and lead prompts say: when you finish visible work, take a screenshot or register the page; when you have alternatives, make an options group; always say which round you are in.
- **UI**: a **Work** tab on the workspace (`?tab=work`) beside Sessions, Notes, Tasks, Runs: a gallery of artifacts grouped by round, newest round first; options groups render side by side with a "Prefer this" button that posts a message to the owning session and records a decision; a "Since round N" diff toggle; each artifact opens a lightbox with a comment composer (workstream 6). The run panel's lane rows link to their latest artifact. The town center's hover card shows the latest screenshot thumbnail.
- **Report**: the orchestration report note embeds the final-round artifacts per lane as image links into the artifact files, which the Library renders.

Acceptance: a worker building a settings page ends with two screenshots and an options group of two layouts; the Work tab shows them side by side; "Prefer this" sends the choice back and the decision appears in `decisions.md`; "Since round 1" shows only that worker's diff since the last approval.

### 5. One inbox

Implemented foundation: `lib/attention/` is realised as `lib/notifications/`, with persisted notifications, `/inbox`, SSE, and desktop alerts. Permission, question, and plan rows are persisted and auto-resolved. The planned `escalation`, `review_request`, and `merge_approval` kinds below remain future additions to `NOTIFICATION_KINDS`; they do not need a separate attention table.

- `lib/attention/`: `types.ts` with `AttentionItem = { id, kind, projectId, workspaceId, sessionId, requestId?, title, detail, createdAt, urgency, actions: AttentionAction[] }` where `kind` is `permission | question | plan | escalation | review_request | merge_approval | thread_reopened | run_failed`, and `AttentionAction` is `{ label, method, path, body? }` so the client never hardcodes routes per kind. `service.ts` composes items from: parked permission and question requests (`session-registry` pending map), documents in `sent` status awaiting plan decisions, escalations (workstream 3), review requests and merge approvals (workstream 6), routine and orchestration runs in `needs_attention` or `failed`. Persisted kinds (`escalation`, `review_request`, `merge_approval`) get a table in `0010_attention.sql`; the transient kinds are computed.
- Routes: `GET /api/attention` (all projects, ordered by urgency then age), `GET /api/attention/events` (SSE, fed by the same in-process emitter pattern tasks use), `POST /api/attention/[id]/dismiss` for kinds that allow it.
- **Inbox page** `/inbox` and a sidebar entry with a live count. Each row shows kind, project and workspace, who is asking (lead, worker and task, routine), age, and inline actions: Allow and Deny for permissions; the question form for questions and escalations, with the lead's recommendation preselected; Approve and Request changes for plans; Approve, Request changes, and Open review for review requests; Approve merge for merge approvals with the gate checklist visible. Keyboard: `j`/`k` move, `a` approve, `r` request changes, `o` open the session.
- **Routing back**: every action posts to the session route that owns the request (`/api/sessions/[id]/permission`, `…/input`, `…/plan`) or to the review route (workstream 6). The inbox never answers on the server's behalf; it is a client of the same APIs.
- The ambient hub's "Needs attention" becomes a summary of the inbox (top three items, "Open inbox"). Sidebar project badges count inbox items per project.

Acceptance: with two workers waiting on permissions, one lead escalation, and one review request across two projects, `/inbox` shows four rows; approving a permission from the inbox clears it in the session view within a second; answering an escalation unblocks the worker.

### 6. Feedback threads and the merge gate

- **Threads beyond documents**: `comments` gains `target: { kind: "document" | "file" | "artifact", documentId? , workspaceId?, path?, line?, artifactId? }` and `assignee_session_id`. The diff view and the Work tab get the comment bubble menu. `lib/revisions/build-payload.ts` gains a `<feedback_round>` message: every open thread addressed to that session with its quote, target, and body, sent when the person clicks **Send feedback** on a workspace (one message per addressed session).
- **Resolution**: new `thread_resolve({ threadId, evidence: { commit? | documentId? | artifactId? | path? }, note })` tool for workers and the lead. Resolving without evidence is rejected. The thread shows the evidence inline; the person can reopen, which creates a `thread_reopened` inbox item for the assignee.
- **Review request**: lead or worker calls `review_request({ workspaceId, taskId?, summary, risk?: "low" | "medium" | "high" })`. Thunk starts a reviewer session (origin role `reviewer`, read-only tools, cwd on the branch) with a prompt to review the diff since the branch base, run the test script, and end with a `review-verdict` fence: `verdict: approve | request_changes`, `risk`, `findings[]` (file, line, body). Findings become threads assigned to the worker. The verdict creates a `review_request` inbox item summarizing it.
- **Merge gate** (`lib/projects/merge-gate.ts`): `mergeGate(workspaceId)` returns `{ ok, checks: [{ id, label, ok, detail }] }` for: run or test script exit zero on the current head (recorded by the lifecycle runner per head), latest reviewer verdict is `approve` and newer than the head, zero open threads targeting the workspace, and `risk !== "high"` or an approved `merge_approval` item. The workspace Git controls call it before Merge and Squash and render the checklist; the lead calls it before recommending a merge. `thunk.json` gains `"gate": { "requireReview": true, "requireTests": true }` to relax it per project.
- **Approve anything risky**: a `high` risk verdict creates a `merge_approval` inbox item; approving it records who and when in the item and unlocks the gate for that head only. A new head invalidates it.

Acceptance: a worker finishes; the lead requests a review; the reviewer posts two findings and `request_changes`; the findings appear as threads on the diff and in the inbox; the worker fixes them and resolves each with a commit; the reviewer re-runs and approves; the Merge button turns from a checklist with two red items to green; the lead's status line says `next: merge <branch>`.

### 7. Later

- Workers spawning workers, with depth and total limits.
- Lead-to-lead handoffs across projects (a multi-repo change that spans two projects).
- Auto-merge for `low` risk, tests green, review approved, when the project opts in.
- A GitHub reviewer mode: the reviewer posts its findings as a GitHub review via `gh`, and the gate reads GitHub review state for branches merged outside Thunk.
- Video capture of a flow (Playwright trace to a short clip) as an artifact kind.
- Lead weekly summary as a routine: what shipped, what is stuck, decisions made.

## Changes to existing code (summary)

| File | Change |
|---|---|
| `lib/agent/types.ts`, `lib/routines/types.ts` | `role: "lead" \| "reviewer"` on `OrchestrationOrigin`; `SessionOrigin` move per orchestration plan |
| `lib/agent/options.ts` | Mount lead, worker, reviewer tools by role; `disallowedTools` for lead and reviewer; inject plan and decisions for the project |
| `lib/agent/permissions.ts` | Route `AskUserQuestion` to the lead for `askLeadFirst` workers; Bash write-pattern denial for leads |
| `lib/agent/session-registry.ts` | Pending questions keyed by `questionId`; `lastActivity` per session |
| `lib/notes/prompt.ts` | Separate budget for the project plan and `decisions.md` |
| `lib/documents/types.ts` | Rename `Artifact` → `DocumentArtifact`; comment `target` and `assigneeSessionId` |
| `lib/revisions/build-payload.ts` | `<feedback_round>` payload |
| `lib/projects/checkpoints.ts` | `round-N` labels and lookup by round |
| `lib/projects/workspace-git.ts`, `components/workspace/git-*` | Call `mergeGate` before Merge and Squash; render the checklist |
| `lib/projects/lifecycle-config.ts` | `gate` config |
| `components/ambient/ambient-hub.tsx`, `components/layout/app-sidebar.tsx` | Inbox summary and counts |
| `components/workspace/workspace-tabs.tsx` | Work tab |
| `components/canvas/diff-view.tsx`, `components/comments/*` | File and artifact targets |
| `components/project/*`, `components/town/*` | Lead card, what's stuck, screenshot thumbnails |
| `instrumentation.ts` | Resume leads on start; reconcile reviewer sessions |
| `README.md`, `PRODUCT.md` | Lead, Work, Inbox, gate; terminology |
| new `supabase/migrations/0008_leads.sql`, `0009_artifacts.sql`, `0010_attention.sql`, comments alter | Schema |
| new `lib/lead/{types,schema,prompt,service,state,tools}.ts` | Lead |
| new `lib/artifacts/{types,store,tools,screenshot}.ts` | Artifacts and Playwright capture |
| new `lib/attention/{types,service,events}.ts` | Inbox |
| new `lib/review/{reviewer-prompt,verdict,request}.ts`, `lib/projects/merge-gate.ts` | Review and gate |
| new `app/api/projects/[id]/lead/**`, `app/api/attention/**`, `app/api/workspaces/[id]/artifacts/**` (replacing the documents list route, which moves to `…/documents`), `app/api/workspaces/[id]/review/**`, `app/api/threads/**` | Routes |
| new `components/lead/*`, `components/inbox/*`, `components/work/*`, `components/review/*` | UI |
| new `tests/lead.test.cjs`, `tests/attention.test.cjs`, `tests/merge-gate.test.cjs`, `tests/artifacts.test.cjs` | Tests |

## Risks

- **A lead that talks too much.** Every worker settle and question is a lead turn. Mitigation: `workers_wait` batching from the orchestration plan, summaries not transcripts, a per-project daily cap shown on the project page, and a lead model default one tier below the worker default.
- **A lead that answers wrong.** Workers may accept a confident wrong answer. Mitigation: every lead answer is logged in the worker transcript and in `decisions.md` with a `by: lead` marker; the inbox shows the last N lead answers per day for spot checks; `askLeadFirst` is a per-brief switch.
- **Enforcing read-only.** `disallowedTools` covers the SDK tools; Bash is a pattern match and will have gaps. Mitigation: the reviewer and lead run with `permissionMode: "default"` for Bash so anything outside the allowlist parks as a permission you see.
- **Screenshots need a running app.** Projects without a Run script cannot capture. Mitigation: `artifact_screenshot` fails with a clear message and the worker falls back to `artifact_add` for files; the Work tab still shows diffs and documents.
- **Gate friction.** A gate that blocks a one-line fix is a gate people disable. Mitigation: `thunk.json` `gate` config, `low` risk skipping the approval step, and the checklist always explaining what is unmet.
- **Thread sprawl.** Findings from a strict reviewer can bury the worker. Mitigation: reviewer prompt caps findings at 10 and asks for severity; the gate only counts `blocking` threads.
- **Memory-only mode.** Leads, artifacts, and attention rows live in memory without Supabase and vanish on restart, like tasks. The lead itself survives through the SDK session file, so "Start lead" after a restart resumes it.
- **Codex leads.** The Codex driver mounts the `thunk` server, but long `workers_wait` calls and `disallowedTools` parity are untested. Claude leads first; Codex leads experimental.

## Sequencing and estimate

| Phase | Workstreams | Estimate | Exit criterion |
|---|---|---|---|
| A | 1 (orchestration plan phases A and B) | 5–7 days | Three workers from a brief, report note, lanes with live lines |
| B | 2, 3 | 4–5 days | A project lead that plans, delegates, answers worker questions, survives restart |
| C | 5 | 3 days | `/inbox` across projects with every existing request kind plus escalations |
| D | 4 | 3–4 days | Screenshots and options from workers, rounds, "since last round" diffs |
| E | 6 | 4–5 days | Threads on files and artifacts, reviewer sessions, merge gate with checklist |

Roughly five weeks of focused work. Phase A is the orchestration plan's risk-bearing phase and should be done first. Phase C is cheap and gives immediate value even before leads exist, so it can run in parallel with B. Phase D before E because the gate needs artifacts and rounds to point at.

## Open questions

1. **One lead per project or per workspace?** Drafted: per project, in `main`. A large monorepo might want one per area. Revisit when a project has more than one active plan.
2. **Should the lead be allowed to merge low-risk work?** Drafted: no, it recommends and the gate plus a person merge. "Later" has an opt-in.
3. **Reviewer identity.** A fresh session each review (drafted, cleaner context) or a standing reviewer per project that accumulates judgment in memory? Standing reviewers learn the codebase but drift; fresh ones are consistent. Start fresh, measure.
4. **Where does the inbox live in the town metaphor?** A post office building on the map, or a non-spatial page? Drafted: a page at `/inbox` with a sidebar entry; the map shows a mailbag on towns with items.
5. **Threads on files and git history.** A thread anchored to `path:line` breaks when the file changes. Anchor to a commit plus a diff hunk header and re-anchor on each round, or accept drift and show "moved" like comments on documents do today? Drafted: anchor to hunk header, re-anchor per round, show "moved" when it cannot.
