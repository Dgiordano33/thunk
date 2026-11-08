# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: Thunk's author, a developer who uses it daily to direct coding agents across several repositories. Their job is to work out what should be built, write it down well, hand it to agents, and keep both themselves and those agents focused.

Likely later audience: peers who also work heavily with coding agents. When the two conflict, the author's own workflow decides. Onboarding for strangers is not a current goal.

## Product Purpose

Thunk brings context together so agents can be orchestrated more intelligently. Its main value is giving people a place to write and organize plans, issues, and other artifacts that help create beautiful software, all in a single pane of context that keeps the person and their agents focused.

Success means the context behind the work lives in one place, agents act on it, and the software that comes out is better for it.

## Positioning

Thunk treats the context around agents as the product. Plans, tasks, notes, source material, and standing orders are written, organized, and shared in the same place the agents run, so the person and the agents work from the same artifacts. Chat is one way to act on that context, not where it lives.

## Operating Context

Project memory is also Claude’s auto-memory, so what agents learn on their own is durable. Workspace memory is the task log. Harvest moves what a workspace learned into the project before the workspace goes. Deletion preserves remaining memory and notes in the project granary.

- **Hierarchy:** a project is a git repo or folder, a workspace is a task inside a project (in place or in its own git worktree), and a session is one chat in a workspace.
- **Context artifacts:** notes and notebooks (including repo notebooks whose files stay the source of truth), project and workspace memory, tasks, and the Vault of uploaded source material. Agents can read this context, and can write to notes, memory, and tasks.
- **Document turns:** an assistant's final prose becomes an editable document. The person edits it or comments on it and sends revisions, and plans from plan mode follow the same flow.
- **Orchestration:** routines start agents on schedules or events. A proposal in `docs/orchestration-plan.md` adds briefs built from selected tasks, notes, and free text that dispatch to worker sessions.
- **Delivery:** the workspace has a terminal, Setup and Run scripts, dev-server preview, and Git controls. Towns show PR, check, and deployment status from GitHub.
- **Attention:** an agent can park on a permission, question, or plan, and those moments reach the person through the **Inbox**, with optional desktop alerts.

## Capabilities and Constraints

**Durable commitments**

- The intended shipping form is a Mac app built with Electron (`docs/desktop-app-plan.md`). The UI stays web technology and the browser development workflow keeps working.
- Multiple agents are first-class. Claude and Codex are both supported, so product language and features should not assume only Claude.

**Current facts, not commitments**

- The API accepts loopback requests only, and agents, terminals, and memory run on the user's machine. Whether Thunk stays local-only is undecided.
- Supabase is optional today, and without it most state lives in memory. Whether memory-only operation remains a supported mode is undecided.
- Terminals and agent processes need a long-lived local Node server with native `node-pty`, so this version cannot run serverless.
- Routines fire only while the Thunk server is running.

**Terminology**

- **Notifications / Inbox:** server-created records of requests and outcomes across projects. Action notifications resolve when their cause clears; informational updates resolve when read or dismissed.

Use Project, Workspace, Session, Notes, Tasks, Routines, Vault, and Library. Within the map, projects appear as cities on the world map and as a town center up close, workspaces as farms, and sessions as fields. Closed sessions are fallow fields; archived workspaces are listed in the Town center. The Library building holds notes, the Workshop holds routines, the Town hall holds tasks, and the Vault building holds uploads.

**Undecided**

- Distribution, pricing, and licensing. The repository has no license file.
- Windows and Linux are non-goals for the first Mac app version. Support after that is undecided.

## Brand Commitments

The product name is Thunk. The established name and metadata describe a canvas-style coding harness whose responses are documents you edit, comment on, and send back.

## Evidence on Hand

The README, `docs/desktop-app-plan.md`, `docs/orchestration-plan.md`, and `docs/repo-notes-plan.md` describe the product and its proposals. There are no testimonials, customers, usage figures, benchmarks, or press, and future work must not invent them.

## Product Principles

1. **Context is the product.** When features compete for attention, favor the one that helps people write, organize, or reuse what agents should know.
2. **One pane, one focus.** Plans, issues, notes, and running work belong together. Reduce the reasons to leave Thunk or lose the thread of the task.
3. **Shared artifacts, not transcripts.** People and agents should read and improve the same durable documents, and important thinking should not stay buried in chat.
4. **Build for the daily operator.** Depth and speed for someone who lives in the tool come before explaining it to newcomers.
5. **Agent-neutral by default.** Context and orchestration belong to Thunk, and any supported agent should be able to use them.
