# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: Thunk's author, a developer who uses it daily to direct coding agents across several repositories. Their job is to work out what should be built, write it down well, hand it to agents, and keep both themselves and those agents focused.

Next audience: peers who also work heavily with coding agents and are opening Thunk for the first time. They know agents and Git, but not Thunk's vocabulary or where its context lives. When the two audiences conflict, the author's own workflow decides.

Light onboarding for that second audience is a current goal (`plans/onboarding-plan.md`): a short first-run introduction, empty states that explain what each area is for, and one-time hints at the first real decisions. It stays light. Everything is skippable, shows once, can be replayed from Settings, and never stands between a returning user and their work. Guided tours, sample data in a real install, accounts, and sign-up flows are not goals.

## Product Purpose

Thunk brings context together so agents can be orchestrated more intelligently. Its main value is giving people a place to write and organize plans, issues, and other artifacts that help create beautiful software, all in a single pane of context that keeps the person and their agents focused.

Success means the context behind the work lives in one place, agents act on it, and the software that comes out is better for it.

## Positioning

Thunk treats the context around agents as the product. Plans, tasks, notes, source material, and standing orders are written, organized, and shared in the same place the agents run, so the person and the agents work from the same artifacts. Chat is one way to act on that context, not where it lives.

## Operating Context

Project memory is also Claude’s auto-memory, so what agents learn on their own is durable. Workspace memory is the task log. Harvest moves what a workspace learned into the project before the workspace goes. Deletion preserves remaining memory and notes in the project granary.

- **Ownership and execution:** a project owns chats, notes, canvases, and tasks, and can contain repositories or folders. Starting a standalone chat or engaging an agent allocates an automatic workspace with a clean worktree for that effort (plain folders, which have no Git history, are worked on in place; a project without repos gets an empty directory). Setup runs in the background. Each canvas keeps one workspace shared by its agents and chats, and the chief keeps one across restarts. After a day idle, an automatic workspace with no unmerged work releases its worktree and branch; returning to the effort recreates them at the same path from the base freshly fetched from origin, so its chats, notes, and memory carry on.
- **Navigation:** automatic effort workspaces stay under the project; its row carries their chat counts and activity. Users can explicitly create or surface a workspace for a separate effort. There is no automatic “Local” sidebar child.
- **Context artifacts:** notes and notebooks (including repo notebooks whose files stay the source of truth), project and workspace memory, tasks, and the Vault of uploaded source material. Agents can read this context, and can write to notes, memory, and tasks.
- **Document turns:** an assistant's final prose becomes an editable document. The person edits it or comments on it and sends revisions, and plans from plan mode follow the same flow.
- **Canvas:** a project's boards, at `/{project}/canvas` (the main canvas) and `/{project}/canvas/{boardId}`. You write, draw, and drop images and charts on a canvas, then send what's pending to its agent, which edits the board back. Each canvas has its own agent session and model. Canvases sit in the sidebar under their project, beside its workspaces. Their agent sessions stay out of session lists, and the canvas entry shows whether its agent is working or waiting on you. A card can become a task, a note, or a new session's first prompt, and tasks and notes can be added to the main canvas, each with a link back.
- **Orchestration:** routines start agents on schedules or events. A proposal in `plans/orchestration-plan.md` adds briefs built from selected tasks, notes, and free text that dispatch to worker sessions.
- **Delivery:** the workspace has a terminal, Setup and Run scripts, dev-server preview, and Git controls. Towns show PR, check, and deployment status from GitHub.
- **Attention:** an agent can park on a permission, question, or plan, and those moments reach the person through the **Inbox**, with optional desktop alerts.

## Capabilities and Constraints

**Durable commitments**

- The intended shipping form is a Mac app built with Electron (`plans/desktop-app-plan.md`). The UI stays web technology and the browser development workflow keeps working.
- Multiple agents are first-class. Claude and Codex are both supported, so product language and features should not assume only Claude.

**Current facts, not commitments**

- The API accepts loopback requests only, and agents, terminals, and memory run on the user's machine. Whether Thunk stays local-only is undecided.
- State lives in Postgres: an embedded database in `~/.thunk/db` by default, or any Postgres through `DATABASE_URL`. Memory-only mode (`THUNK_DATABASE=memory`) remains for tests.
- Terminals and agent processes need a long-lived local Node server with native `node-pty`, so this version cannot run serverless.
- Routines fire only while the Thunk server is running.

**Terminology**

- **Notifications / Inbox:** server-created records of requests and outcomes across projects. Action notifications resolve when their cause clears; informational updates resolve when read or dismissed.

Use Project, Workspace, Session, Canvas, Notes, Tasks, Routines, Vault, and Library everywhere outside the map itself, in both looks. The map has two looks (Settings → Look). In the default **Solar system** look, projects are planets, workspaces are moons and sessions are satellites; closed sessions are hollow; Notes, Tasks, Routines, Vault and Canvas are a plain section bar. In the **Game world** look, projects are cities on the world map and a town center up close, workspaces are farms and sessions are fields; closed sessions are fallow fields; the Library building holds notes, the Workshop routines, the Town hall tasks and the Vault building uploads. Game words appear only on the game map; panels use the plain terms. Archived workspaces are listed in the project overview.

**Undecided**

- Distribution, pricing, and licensing. The repository has no license file.
- Windows and Linux are non-goals for the first Mac app version. Support after that is undecided.

## Brand Commitments

The product name is Thunk. The established name and metadata describe a canvas-style coding harness whose responses are documents you edit, comment on, and send back.

## Evidence on Hand

The README, `plans/desktop-app-plan.md`, `plans/orchestration-plan.md`, `plans/onboarding-plan.md`, and `docs/repo-notes-plan.md` describe the product and its proposals. There are no testimonials, customers, usage figures, benchmarks, or press, and future work must not invent them.

## Product Principles

1. **Context is the product.** When features compete for attention, favor the one that helps people write, organize, or reuse what agents should know.
2. **One pane, one focus.** Plans, issues, notes, and running work belong together. Reduce the reasons to leave Thunk or lose the thread of the task.
3. **Shared artifacts, not transcripts.** People and agents should read and improve the same durable documents, and important thinking should not stay buried in chat.
4. **Build for the daily operator.** Depth and speed for someone who lives in the tool come first. Explain Thunk to newcomers in the places they would otherwise be stuck, such as first run and empty screens, and never by slowing down someone who already knows it.
5. **Agent-neutral by default.** Context and orchestration belong to Thunk, and any supported agent should be able to use them.
