# Thunk

A personal Claude Code harness where assistant responses aren't chat bubbles: each turn's final prose becomes an editable document. Edit it directly, highlight spans to comment or ask questions, then **Send revisions**. Claude receives a unified diff, the quoted comment threads, and the full edited document, and replies with a revised version (v2, v3, …). Plans from plan mode use the same flow: edit or comment, then **Request changes** or **Approve**.

Projects, workspaces (git worktrees), sessions, notes, tasks, routines, a vault and canvases hang off that. For how the pieces fit together, with diagrams, start with [How Thunk works](docs/how-thunk-works.md). Implemented features are documented in [docs/](docs/); unfinished proposals live in [plans/](plans/).

## Install

There are two ways to run Thunk. Both keep your data in `~/.thunk` and need no database or account setup.

### Desktop app

No Node, npm or source checkout needed.

1. Download the archive for your machine from the [latest release](https://github.com/Dgiordano33/thunk/releases/latest): `Apple-Silicon` or `Intel` for macOS, `Linux-x64` or `Linux-ARM64`, or `Windows-x64`.
2. Unzip it. On macOS, move `Thunk.app` to Applications.
3. Open it. The builds are not signed with a developer certificate, so the first launch needs your approval:
   - **macOS:** open Thunk once, dismiss the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/Thunk.app` before opening it.
   - **Windows:** in the SmartScreen dialog, click **More info → Run anyway**.
   - **Linux:** on Ubuntu 24.04 and later, see the sandbox step in [docs/desktop.md](docs/desktop.md#linux).
4. In the Connections window that opens, connect Claude (an Anthropic API key, or your existing `claude` login is picked up automatically), and optionally GitHub and Codex.

You need Git installed; Thunk tells you how if it is missing. To build the app yourself or publish releases, see [Thunk desktop app](docs/desktop.md).

### From source

You need:

- **Node.js 22.16 or later** (24 recommended; `nvm use` picks it up from `.nvmrc`) and **Git**.
- **Claude access:** a logged-in [Claude Code](https://claude.com/claude-code) CLI (`claude`), or an Anthropic API key.
- **GitHub CLI** (`gh auth login`), optional: PR, check and deployment status need it.

```bash
git clone https://github.com/Dgiordano33/thunk.git
cd thunk
npm install
cp .env.local.example .env.local   # every setting is optional
npm run dev                        # http://127.0.0.1:4500
```

Open the URL, add a project (any git repo or folder), and start a session.

- **Auth:** set `ANTHROPIC_API_KEY` in `.env.local`, or leave it empty to use your local `claude` login.
- **Port:** `npm run dev` uses `$PORT`, else `$THUNK_PORT`, else `$CONDUCTOR_PORT`, else 4500.
- **Database:** projects, workspaces, sessions, documents, comments, tasks, routines and notifications are stored in Postgres, so they survive restarts and sessions can be resumed (SDK `resume`). With no settings, Thunk runs an embedded Postgres (PGlite) in `~/.thunk/db`: nothing to install. To use your own Postgres (Supabase, Neon, RDS, a local server), set `DATABASE_URL`. See [Database](#database).
- **Memory and notes files:** always on disk under `~/.thunk` (override with `THUNK_DATA_DIR`).
- **Browser tests:** `npx playwright install chromium` once, then `npm run test:e2e`. They start their own dev server (port 4517, build dir `.next-e2e`) with in-memory projects and a temp data dir, so they run beside your dev server without touching your data.

### Other ways to run it

- **From your phone or another computer:** over a private Tailscale network. See [Use Thunk from your phone](docs/remote.md).
- **Around the clock on a Linux server:** see [Run Thunk on a server](docs/server.md).

## Database

Thunk creates and updates its tables itself. On startup it applies any migrations in `db/migrations/` that haven't run yet, each in its own transaction, and records them in a `thunk_migrations` table. There is nothing to apply by hand. If you do apply one by hand through Supabase (dashboard, CLI or MCP), name it like the file without its timestamp, for example `0014_something`; Thunk finds it in Supabase's migration history on its next start and records it instead of running it again.

| Setting | What it does |
|---|---|
| *(none)* | Embedded Postgres in `~/.thunk/db` (or `$THUNK_DATA_DIR/db`). One Thunk process can open it at a time; a second one, such as a dev server beside the Mac app, keeps its data in memory and logs why. |
| `DATABASE_URL=postgres://…` | Any recent Postgres (tested with 17, which the embedded database also runs). For Supabase, use **Connect → Session pooler** (port 5432); the transaction pooler (6543) is not supported. |
| `THUNK_DATABASE=memory` | Keep everything in memory, as browser tests do. |
| `THUNK_DATABASE=embedded` | Use the embedded database even if `DATABASE_URL` is set. |

Thunk runs a scheduler and delivery polling, so point only one running Thunk at a database.

**Developing with production data.** Don't point a dev server at the production database: its scheduler would run beside the real one, and anything you try would change real data. Copy it instead:

```bash
npm run db:pull   # asks for the source connection string, e.g. Supabase's Session pooler string
```

This reads the source in one read-only snapshot and replaces the local embedded database (`~/.thunk/db`) with the copy, keeping the previous one as `~/.thunk/db.backup-…`. Routines are turned off in the copy so nothing fires twice. Stop the Mac app and local dev servers first; the command refuses to run while one holds the database. Run it again whenever you want fresh data. Notes, memory and vault files live under `~/.thunk/projects` on the server and are not copied. Set `THUNK_PULL_URL` to skip the prompt.

**Backups.** Every day at 03:00, Thunk writes `~/.thunk/backups/thunk-<date>.tar.gz` with the files under `projects/`, `config/` and `homes/` and every database table, and keeps the newest 7. Change the time and count, or back up now, in **Settings → Automation**. `npm run data:backup` makes one from the command line (`-- --with-transcripts` adds `~/.claude/projects`), and `npm run data:restore <archive>` puts one back. See [Backups](docs/server.md#backups).

**Moving from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.** Those settings are no longer read. Thunk refuses to start a database while they are set without `DATABASE_URL`, so data is never silently left behind. Replace them with the project's Session pooler connection string as `DATABASE_URL`. On first start, Thunk reads Supabase's migration history to see what is already applied, then applies whatever is missing. If you applied migrations through the SQL editor so there is no history, set `THUNK_DB_BASELINE` to the last migration you applied, for example `20261111000000_0013_delegation_plans`.

## Hierarchy

- **Project** = a git repo (its toplevel, even when added from a worktree) or a plain folder. Owns `CLAUDE.md` / `.claude/` config and a **project memory** file at `~/.thunk/projects/<slug>/memory/MEMORY.md`, injected into every session's system prompt and editable by agents and from the project page.
- **Workspace** = a task inside a project. Either works in place (the `main` workspace every project gets) or in its own **git worktree** at `<repo>/.claude/worktrees/<slug>` on a new branch (default `thunk/<slug>`, from `origin/<default>`). Has a **workspace memory** directory (`~/.thunk/projects/<slug>/workspaces/<slug>/memory/`) for its shared task log. Claude auto-memory uses project memory. Archive closes its live sessions; deletion preserves memory and notes in the project granary. Harvest promotes selected knowledge and notes to the project.
- **Session** = one chat in a workspace. Runs with `cwd` = workspace dir and, in a worktree, `projectConfigRoot` = the main checkout so config comes from the trusted tree.
- **Canvas** = a board in a project, stored on disk under `~/.thunk/projects/<slug>/boards/<boardId>/` (`board.json` plus one file per card). Every project has a `main` canvas and can have more. Each canvas has its own agent session, started in the main workspace on the canvas's model (`board.json` `model`, else `DEFAULT_MODEL`), and hidden from session lists. Canvases are listed in the sidebar under their project with their agent's status. Other sessions in the project (chats, chiefs, workers and scouts, so anything you relay) can build canvases too: they get `canvas_list`, `canvas_create` and `canvas_*` card tools that name a `canvas_id`, and an open canvas shows their cards live (`/api/projects/[id]/board/events?board=<id>`).

- **Notes** = a notebook per project (`~/.thunk/projects/<slug>/notes/<id>.md`) and per workspace (`…/workspaces/<slug>/notes/<id>.md`). Each note is markdown with frontmatter (`title`, `pinned`, `inject`, `actionable`, `tags`, `created`, `updated`). MEMORY.md shows up as the pinned first note of each scope. Every session gets both notes dirs as readable/writable directories and a `# Thunk notes` block in its system prompt: an index of notes plus the full text of `inject: true` notes (capped at 24k chars). Checklists remain editable in notes; the legacy `actionable` flag is still read for importing old checklist items into Tasks. A file watcher streams changes (including agent edits) to the UI over SSE.

- **Routines** = standing orders for agents: a prompt, model and permission mode that start a session on a cron schedule, on **Run now**, or on events (a new GitHub PR, polled every ~2 min via `gh`; a workspace's Run script exiting non-zero; a local webhook `POST /api/routines/[id]/webhook?token=…`; a task being created or completed, unless a routine session did it). A routine can attach notes (project, workspace or repo notebook), tasks and Vault items as **Context**, or point at a saved context set: each run reads their current text into its brief, with the triggering task first for task events (`{{event.task.id}}`, `{{event.task.title}}`, `{{event.task.body}}`). Each run gets a fresh worktree by default (removed when nothing changed, archived otherwise) or runs in a chosen workspace. Prompts, questions and plans park the run as *Needs you*. When a run ends, its summary, diff stat, PR link and cost are recorded and a report note is written to the project's notebook, listing the tasks the run filed or worked on and the notes it wrote. Routine sessions file tasks at project scope by default (marked as created by a routine), and a fresh worktree's notes and tasks move to the project before the worktree is removed or archived, so they stay in the Library and the project's task list. Guardrails: one run per routine, max runs/day (default 24), a per-run time limit (default 60 min), and at most 3 routine runs at once (change it in Settings → Automation). Scheduled, new-PR and delivery firings are written to a durable queue (`routine_triggers`) together with the schedule or poll cursor, so a crash or restart never loses or doubles one. When every slot is taken, or the routine's previous run is still going, the firing waits and retries with backoff, and is recorded as *Skipped* only after an hour; a reached daily limit skips it straight away. A firing that fails to start is retried three times, then shows in the Inbox. Webhook, Run-script and task firings still skip straight away when a guardrail declines them. **Routines fire only while the Thunk server is running**; runs open at shutdown are marked interrupted on the next start, and a routine that asks to catch up retries an interrupted run once and runs a missed schedule once on start.

- **Vault** = the project's source material. Upload docs, PDFs, images, slides (.docx/.pptx/.xlsx), transcripts or pasted text (25MB per file); Claude reads each one in the background (a tool-less one-shot Agent SDK call, so it works with your local `claude` login) and stores a summary, up to 12 ideas and tags beside the original under `~/.thunk/projects/<slug>/vault/<id>/`. Send any idea to the project notebook or make it a task. Agent sessions get read-only `vault_list` / `vault_read` tools and file access to the originals.

Pages: `/` projects · `/p/[id]` project (workspaces, notes in the Library building, other Claude Code transcripts on disk for this repo that you can import) · `/w/[id]` workspace (sessions, git status, Notes and Tasks tabs) · `/s/[id]` session · `/{project}/canvas[/{boardId}]` a canvas (`?card=<id>` centres and focuses a card; old `?session=<boardId>` links redirect) · `/notes` the Library (every notebook; `?scope=p:<id>|w:<id>|r:<id>&note=<id>`) · `/routines` every routine (each project holds its own: `/p/[id]?building=workshop`) · `/vault` every project's uploads (each project's Vault: `/p/[id]?building=vault&item=<id>`).

Vault API: `GET/POST /api/projects/[id]/vault` (multipart `file` and/or `text`), `GET/PATCH/DELETE …/vault/[itemId]` (`{title}` or `{reextract: true}`), `GET …/[itemId]/file` (`?download`), `POST …/[itemId]/promote` (`{ideaId, to: "note"|"task"}`), `GET /api/vault` (all projects).

Routines API: `GET/POST /api/routines` (`?projectId=`), `GET/PATCH/DELETE /api/routines/[id]`, `POST …/run`, `GET …/runs`, `DELETE …/runs/[runId]` (cancel), `POST …/webhook`.

Notes API: `GET/POST /api/{projects|workspaces|repos}/[id]/notes`, `GET/PATCH/DELETE …/notes/[noteId]` (`memory` is the MEMORY.md note: markdown edits only, not deletable), `GET /api/notes` (all notebooks), `GET /api/notes/events` (SSE).

Retune's visual editor is available in development. Press `⌥D` (Alt+D) to toggle editing. The project `.mcp.json` configures its local MCP server for compatible agents; other clients can use `npx --no-install retune` from the project root. Restart your agent to load the configuration, or use Retune's clipboard output to apply edits. See the [Retune docs](https://github.com/khadgi-sujan/retune).

## Tasks

Open **Tasks** from the general Vanilla sidebar to choose a project and manage its project and workspace tasks at `/tasks`.

Tasks have stable IDs, status (open, in progress, blocked, done, cancelled), priority, optional markdown detail, due date, note link, and an owning session. Open the **Tasks** tab in a workspace (`/w/<id>?tab=tasks`) for workspace and project tasks, or the project's **Tasks** section (`/p/<id>?building=tasks`) for the project's full list grouped by workspace. Sidebar badges show open counts and update live.

Enter a title to create a task; use ⌘↵ to add details. Open a task to edit its fields, or send it to an existing session or a new chat. Claude and Codex receive `tasks_list`, `tasks_create`, `tasks_update`, and `tasks_complete` tools and the current workspace/project open-task context. IDs may be full UUIDs or unambiguous prefixes. Codex threads created before task tools were added need a new session; newly created threads retain the tools when resumed.

Existing actionable notes are not migrated automatically. The workspace Tasks tab offers to import unchecked checklist items from workspace and project notes, preserving the note text and linking each imported task to its note.

Tasks are stored in the database. Task events use an in-process SSE feed, like other local runtime features.

Tasks API: `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/[id]`, `POST …/[id]/send`, `GET /api/tasks/tree?projectId=…`, `GET /api/tasks/counts`, `GET /api/tasks/events`, and `GET/POST /api/tasks/import-notes`. Run `npm run test:tasks` for task checks.

## Context

Open a session and pick the workspace panel's **Context** tab (`?tab=context`) to see what that session was given:

- **In the prompt**: project instructions, project memory, injected notes, pinned Vault summaries and the open-task list, recorded each time the session starts or resumes (`session_context_items`, origin `prompt`). Items cut at a limit say so.
- **Attached**: what was sent into the conversation after it started, such as a routine's brief and its attached notes and tasks.
- **Fetched later**: notes, memory files and Vault items the agent read itself, through `vault_read` or a `Read` of a file in the project's notes, memory or Vault directories.
- **Left out**, with the reason: over the 24,000-character note limit (12,000 for pinned Vault summaries), not marked to inject, not pinned, or no longer there.

An item whose file or task changed since the session got it shows **Changed, not sent**. Notes have no history, so the version is a hash of the text the session got.

- **Attach** picks a note, task or Vault item and pushes it into the running session as a `<context_attachment>` message (resuming the session if its runtime exited).
- **Send update**, on a changed note, pushes a `<note_update>` with a unified diff from the session's copy to the current text (built like a document revision) and records the new version. The note editor shows the same **Changed, not sent** row, with Send update, for each running session that holds an older copy.
- **Remove** leaves a prompt item out from the next start or resume; the running system prompt can't change mid-run, and the view says so until then. **Keep** undoes it.

**Context sets** are saved selections of notes, tasks and Vault items in a project (`context_sets`). Save a routine's Context list as a set from the routine form; a routine can then point at the set instead of keeping its own list, and every run reads the set's current items. A new chat offers the project's sets beside the model picker: the chosen set's items ride along with the first message and show as Attached. Deleting a set sends routines that used it back to their own lists.

Context sets API: `GET/POST /api/projects/[id]/context-sets` (`{name, notes, taskIds, vaultIds}`), `GET/PATCH/DELETE /api/context-sets/[id]`; `POST /api/sessions` takes `contextSetId`.

Context API: `GET /api/sessions/[id]/context` (items, each with `changedSince`), `POST /api/sessions/[id]/context` (`{kind: "note", scope, id}`, `{kind: "task" | "vault", id}`), `POST /api/sessions/[id]/context/[itemId]` (`{action: "update" | "remove" | "keep"}`), `GET /api/context/note-sessions?path=<note path>`.

## How it works

For the product-level picture (objects, Relay, the context loop), see [How Thunk works](docs/how-thunk-works.md). The code is laid out as follows.

- `lib/routines/`: types, zod schema, cron helpers and prompt templating (client-safe), the scheduler (`scheduler.ts`, started from `instrumentation.ts`), runner, report, PR poller and event triggers.
- `lib/notes/`: note frontmatter parsing (`frontmatter.ts`, client-safe), file store (`store.ts`), scope → dirs (`resolve.ts`), the system-prompt block (`prompt.ts`), and the `fs.watch` feed (`watch.ts`).
- `lib/projects/`: project detection (`git.ts`), worktree create/remove/status, memory file paths (`paths.ts`), and the project/workspace service (`index.ts`) incl. importing external SDK sessions via `listSessions({ dir, includeWorktrees })`.
- `lib/agent/`: one long-lived `query()` per session (streaming input via `AsyncQueue`), pinned to `globalThis` so HMR doesn't orphan subprocesses. `event-bridge.ts` turns SDK messages into `HarnessEvent`s; `permissions.ts` parks `canUseTool` calls (tool approvals, `AskUserQuestion`, `ExitPlanMode`) until the UI answers. Sessions load the workspace's CLAUDE.md and `.claude/settings*.json`, but not `~/.claude`.
- `app/api/sessions/[id]/stream`: SSE with `since=<seq>` / `Last-Event-ID` replay. POST routes handle input, permissions, answers, plan decisions, and control (interrupt, model, mode, close).
- `lib/store/session-store.ts`: a single event reducer, used for both live SSE and hydrating from the database.
- `components/board/`, `lib/board/`: the Canvas. The page lives in the workspace shell (`app/(shell)/[project]/canvas/[[...board]]`). `lib/board/routes.ts` serves `/api/projects/[id]/board` (main) and `…/boards/[boardId]`; `PATCH` takes `viewport`, `name` and `model`. Cards can be sent on as a task, a note or a new session's prompt from their toolbar menu.
- `components/document/`: TipTap editor per document. Comments are a `comment` mark, so anchors move with edits. Diffs run against the editor's own round-tripped markdown, so untouched documents show zero edits.
- `lib/revisions/build-payload.ts`: the `<document_revision>` message format.

Keyboard: `⌘⌥M` comment on selection, `⌘↵` send revisions (in a document), `Esc` interrupt.

## Workspace lifecycle

The workspace footer has a persistent PTY terminal, Setup / Run output, dev-server controls, a preview, and Git actions. Terminal processes survive navigating between sessions; archive closes terminals and agents. Run becomes a preview link once the assigned port accepts connections. The embedded preview also has an external-browser link for apps that disallow framing.

Commit a `thunk.json` in the **registered project root** (legacy `conductor.json` with string scripts is also accepted):

```json
{
  "scripts": {
    "setup": "npm ci",
    "run": "npm run dev -- --port $THUNK_PORT",
    "archive": "docker compose down"
  },
  "filesToCopy": [".env.local", "config/local.json"]
}
```

A new worktree copies these files without overwriting existing files, then runs setup automatically. Omit `filesToCopy` to copy regular root `.env*` files; use `[]` to copy none. Entries are relative file paths, not globs; symlinks and paths outside the root are refused. Setup failures keep the workspace and its output so you can fix the problem and retry Setup. The main in-place workspace does not run setup automatically. Setup / Run / Archive commands are always read from the registered root, not the task branch.

Scripts run in the user's login shell with the workspace as cwd. The terminal uses an interactive login shell. Each workspace gets a separate `THUNK_PORT` (also `PORT` and `CONDUCTOR_PORT`); configure the dev command to honor it. `THUNK_WORKSPACE_ID`, `THUNK_WORKSPACE_NAME`, `THUNK_WORKSPACE_PATH`, `THUNK_ROOT_PATH`, and `THUNK_DEFAULT_BRANCH` are also set, with equivalent `CONDUCTOR_*` aliases. Run is explicit; setup never starts a dev server automatically.

Git controls operate locally: **Sync** fetches origin's default branch and merges it into the workspace; **Rebase** rebases onto that branch. **Merge** and **Squash** integrate committed work into the local default branch, which must already be checked out and clean in the project root. They do not push. Conflicts list affected files and offer abort / rebase-continue controls. Resolve and stage files in the terminal; root merge conflicts must be resolved in the root (`cd "$THUNK_ROOT_PATH"`). Squash failures restore the previously clean target checkout and retain the workspace commits.

**Then delete workspace** runs the archive hook and removes the merged worktree and its sessions. Deletion refuses dirty or unmerged work and never force-removes a worktree. Git branches are retained. Archive alone keeps the worktree; a failed archive hook keeps the workspace active and its logs available. Stop active agents in the project before using Git controls.

Process state and bounded terminal output live in the Thunk server, survive development hot reload, and reset on server restart. These features require local Node.js with the native `node-pty` module; they cannot run in a serverless deployment. The checked-in `thunk.json` configures Thunk's own install and dev commands. Run `npm run test:lifecycle` for isolated Git fixtures and real PTY / preview checks.

## Delivery status

Workspaces on the Solar system map show PR/check marks (– draft, … running, ✓ passed, × failure/conflicts, ? unknown) and a dev-server cue on the moon's label when their local dev server is running. Open a workspace for its Delivery section: checks, reviews, agent hand-offs, Start/Stop dev server, and deployed/local preview links. Hover cards include branch divergence and uncommitted changes; divergence uses local refs and does not fetch origin.

The scheduler caches open PRs per project through `gh api graphql`, polling about every 60 seconds, or 10 seconds while checks are pending. Local Git/runtime status refreshes about every 10 seconds. GitHub failures retain the last result with an explicit warning and back off to 60 seconds. GitHub CLI authentication is required; folder projects and repositories without an origin still show local runtime status. Preview links come from successful deployments on the PR head commit; providers must publish GitHub Deployments for these links to appear.

PR lists are paginated. Each head includes up to 100 checks and the last 20 deployments; truncated check lists show an additional pending row linking to GitHub, never an all-green result. Delivery snapshots and the last 200 activity events per project persist in `~/.thunk/projects/<project>/delivery.json` (or `THUNK_DATA_DIR`). Game-look hover cards show the latest event; Delivery panels show the latest ten events for their branch. Events cover CI passing/failing, posted reviews, new review requests, successful deployments, and confirmed PR merges. Reviews inspect the latest 20 submissions and up to 100 outstanding requests. A missing open PR is checked separately before reporting a merge. First observations are quiet baselines; polling can miss transitions that begin and end between polls. The **Inbox** (`/inbox`) keeps session requests, routine outcomes, delivery updates, script failures, and agent notifications. Action items resolve when their cause clears; informational items resolve on read. Active projects keep polling while the server runs, even with no browser tab open. Notifications persist in the database; in memory-only mode the latest 500 survive for the server process lifetime. Desktop alerts are opt-in, can be muted by kind in Settings, and only fire for new notifications while a tab is connected. Session silence is flagged after 10 minutes; pending CI after 30 minutes of observation (the CI timer restarts with the server).

The Workshop routine form supports `ci_failed`, `review_requested` (a reviewer/team is requested, not a changes-requested decision), and `deploy_ready`. Prompts can use `{{event.pr.url}}`, `{{event.pr.branch}}`, `{{event.pr.head}}`, `{{event.checks}}`, `{{event.previewUrl}}`, or `{{payload}}`. Workspace targets match their current branch; fresh-worktree targets ignore `thunk/*` branches to prevent automation loops. Existing run limits still apply. Subscription changes and re-enabling a routine establish a new baseline; recovered CI and superseded commits are skipped.

Each delivery event becomes a row in `routine_triggers` (keyed by routine and event id) in the same statement that moves the routine's `trigger_state` cursor, as the PR trigger does. The scheduler's dispatcher then starts it, so starts are at-least-once: a crash between queuing and starting only delays the run, and a busy slot makes it wait rather than skip. In memory-only mode, routines/cursors remain in memory; local delivery history still survives restarts. Run `node --conditions=react-server --test tests/delivery.test.cjs tests/delivery-history.test.cjs tests/routines.test.cjs` for delivery and routine checks.

### Repo notebooks

In a project's Library building, open **Repo notebooks** to register an existing folder in the primary or an extra repo. Suggestions include `.claude/plans`, `.claude/tasks`, `docs`, and `plans`, with file counts. The Library reads the registered main checkout, never a workspace's worktree. Flat Markdown files with filename stems matching `[a-z0-9][a-z0-9_-]{0,63}` are supported; `memory` is reserved. There is no pinned memory file for a repo notebook.

Repo files remain the source of truth: saves and deletes change the working tree, with no copies or automatic git commits. Unknown frontmatter is preserved; body-only edits do not add frontmatter. Removing a notebook only unregisters it. Declare portable additions with `"notebooks": [".claude/plans", ".claude/tasks"]` in `thunk.json`; declarations are registered on project load, so remove an entry from that file before unregistering it permanently. A declared folder must already exist.

Use the Tasks import banner to import unchecked items from repo boards into project tasks. Completing or cancelling an imported task checks its box; reopening unchecks it. Repo task links include the notebook id and filename, so identical filenames in different folders do not collide. Write-back verifies the current text and follows moved lines; if a board or item disappears, the task remains and its detail view shows “Not in board” or “Board unavailable.” Write-back failures are logged and do not roll back the task status. The file wins for existence; Thunk wins for status during a session of edits. Headings are ordinary Markdown, not task columns.

Repo notes are included in session indexes, note mentions, and the shared 24k-character injection budget. Agents in worktrees should edit their branch's copy; the Library reflects those edits after merge.

Pick the app's look in **Settings → Appearance → Look**; it is stored in the `thunk.look` cookie. The default **Solar system** look shows every project as a planet around a star (bigger planets have more workspaces and sessions). Inside a project, the project is the planet in the middle (open it for the overview), workspaces you create are moons and sessions are satellites that grow with spend; closed sessions are hollow. Sessions in the project's own workspaces (its home workspace and automatic ones, which the sidebar folds into the project row) orbit the planet itself. Notes, Tasks, Routines, Vault and Canvas sit in a bar along the bottom. It supports light and dark. The optional **Vanilla** look replaces Game world with a neutral application layout: a bar across the top with Search and Relay, a persistent desktop sidebar with two levels (Projects, Inbox, Tasks, Notes, Vault and Routines in general; inside a project, its Inbox, Tasks, Notes, Vault, Routines and Settings above each workspace and its sessions), a searchable project list with live status, and project pages with workspace lists and recent sessions. Tools fill the content area rather than floating over a map. Both looks support light, dark, and system appearance and share the same features; archived workspaces remain accessible in the project overview. Saved Game world preferences automatically open Vanilla. Phones retain the compact list navigation in both looks.


### Project chiefs and workers

Open the project overview (the planet in Solar system, or Settings in the project sidebar in Vanilla) → **Open the chief** to resume the project's coordinating session in `main`; **New chief** starts fresh using the same workspace memory. The chief delegates each task to a worker in a new Git worktree or an existing project workspace (`workspaceId`), with at most four active workers by default (see [Limits](#limits)). Existing workspaces allow one active worker at a time and cannot be combined with `repoIds`, scout mode or races. Worker setup completes before its session starts. Workers retain their branches and workspaces for review; nothing merges automatically.

Use **Relay** on a saved project note to ask the chief to split its unchecked checklist items into tasks. Each worker receives the note text (up to the existing 24k-character budget), its path, and the linked task. The task send menu also offers **New worktree**, which runs a worker without a chief. Delegation requires Git repositories; plain folders are excluded from default worker selection.

Reports appear in the inbox and are pushed to the originating chief in 20-second batches. A worker's questions go to its chief first and come to you if the chief hasn't answered within 10 minutes (the chief answer wait); permission prompts and plans still go to you. The daily project **Work log** records lifecycle milestones and decisions; `chief_log` lets the chief record outcomes and update its workspace plan without file-edit tools. The chief accepts successful task completion; workers without a chief complete their tasks directly.

Report outboxes live in Postgres (`worker_reports`, one row per finished turn with when it reached the chief); older `config/worker-reports/<session>.json` files are imported on startup and renamed to `.json.imported`. In memory-only mode they last until the server stops. On restart, live sessions regain watchers, persisted results are reported, and interrupted workers are marked blocked for inspection and continuation. Memory-only sessions and tasks still disappear on restart. Delivery is retryable; a crash between dispatching a message and persisting its receipt can repeat a report.

Claude chiefs disallow Edit, Write and NotebookEdit, and deny common shell-write commands in permission checks. This is not an OS security boundary; shell patterns are incomplete and permission bypass can weaken them. Codex chiefs follow the coordination rule through their prompt. Workers time out after 60 minutes and keep their worktree.

#### What the chief can make

A chief cannot edit files, so it has its own tools for leaving things in the project. They act only inside its project and never ask for permission:

- **Notes.** `notes_create` and `notes_update` write project notes (plans, briefs, decision records), with tags, pin, session context and workspace links.
- **Canvases.** Like every project session, the chief has the canvas tools: `canvas_list`, `canvas_create` and the `canvas_*` card tools for text, images and charts. An open canvas shows its cards as they are added.
- **Workspaces and sessions.** `workspaces_list` and `workspaces_create` manage the workspaces you see in the sidebar. `sessions_start` opens a session in a visible workspace with a first prompt. It is a worker: it has a task and reports back to the chief.
- **Routines.** `routines_create` schedules a recurring agent session. The chief is told to use it only when you asked for something recurring.

Tasks, the work log and workers were already covered (`tasks_*`, `chief_log`, `delegate`). Thoughts sent from the Relay bar reach the chief as a `<relay>` message; see `docs/capture.md`.

#### Running a team

- **Queue and dependencies.** When every worker slot is busy, `delegate` queues the task instead of refusing it. `dependsOn` holds a task until the tasks it names are done (accepted). Queued tasks start on their own, in order, when a worker finishes or a dependency is accepted. If a dependency is cancelled, the waiting task is marked blocked and the chief is told. `workers_stop` also removes a queued task. The task send menu's **New worktree** queues the same way.
- **Overlaps and integration.** `workers_status` and each worker report list files that another open worker branch also changed, including uncommitted edits. `workers_integrate` trial-merges named branches, in order, into a fresh `integration-…` worktree. It aborts and reports any merge that conflicts, then runs `scripts.test` from `thunk.json`, with a 15-minute limit. Nothing is merged into the default branch. The previous integration workspace is archived.
- **Scouts.** `delegate({ mode: "scout" })` runs a read-only worker in the main checkout, with no worktree or setup, and gets a report back. It works in projects without Git repositories. Chiefs and scouts are read-only. In Claude sessions their shell runs only an allowlist of read commands (`ls`, `cat`, `grep`, `rg`, `find`, `git status|log|diff|show|blame`, `gh pr view|list|diff|checks` and similar) with no output redirection, substitution or subshells; a hook enforces it even when your own Claude Code settings allow more. Codex chiefs and scouts run in Codex's read-only sandbox and any request to go beyond it is declined. Both still write notes, logs and tasks through Thunk's tools.
- **Races.** `delegate({ race: [modelA, modelB] })` runs the same task on two or three models, each in its own worktree. Their reports leave the task open. `workers_pick` hands the task to the winner, stops the others and archives their workspaces, keeping their branches.
- **History.** Each task records cost, duration, rounds (reports that needed another pass) and models. Reports show cost for the round and the task. `workers_history` summarizes this per model, and the project overview shows today's worker cost and queue length.
- **Delegation plans.** For a request that needs several workers, the chief proposes the split with `delegate_plan`. It appears in the inbox as a **Chief plan** with Approve and Reject. Approving delegates the tasks in order, mapping plan keys to task IDs for dependencies. Either decision goes back to the chief.
- **Cleanup.** Every 10 minutes Thunk archives worker workspaces that are finished: the task is done and its branch is merged (squash merges count), the task ended with nothing on the branch, or the worker lost a race. Archiving keeps the worktree and branch. Workspaces with an active session, that a person also used, or explicitly selected with `workspaceId` are left alone.

Delegation plans and every trial merge (what merged, what conflicted, the test result and each branch head) live in Postgres (`delegation_plans`, `integrations`). The queue, races, per-task stats and each relayed request's tasks live there too (`worker_queue`, `worker_races`, `task_stats`, `relay_tasks`), so they can be joined to tasks and sessions; in memory-only mode they last until the server stops. Older versions kept all of this in the project's `config/workers/state.json`: on startup Thunk imports that file in one transaction and renames it to `state.json.imported`.

### Limits

**Settings → Automation → This server** sets three limits for the whole server, stored in `~/.thunk/config/limits.json` (or under `THUNK_DATA_DIR`). The API is `GET`/`PUT /api/settings/limits`. A change applies to the next worker, run or question without a restart; a hand edit to the file is picked up the same way. Out-of-range values in the file are clamped and unreadable ones fall back to the default; the API rejects them.

| Setting | Key | Default | Range |
|---|---|---|---|
| Workers per project | `workersPerProject` | 4 | 1–12 |
| Routine runs at once | `routineRunsAtOnce` | 3 | 1–10 |
| Chief answer wait (minutes before a worker's question comes to you) | `chiefAnswerMinutes` | 10 | 1–60 |

A chief's instructions state the worker cap and the answer wait as they were when the session started.

### Relay across projects: top-level notes

The Library's **Top level** notebook holds notes that belong to no single project. **Relay** on one of them sends its open checklist items to an internal routing session, which proposes where each item goes. The proposal appears in the inbox as a **Relay plan** with Approve and Reject. Approving hands each item to that project's chief as a `<routed_request>`, and the project chief delegates it as usual. When the work settles, the project chief calls `route_report` and the result flows back up.

- **Routing tags.** `#project` or `#project/workspace` on a line pins that item to a project or workspace. A `## Project` heading pins the items under it. A tag beats a heading, and a heading that names no project ends the scope. It must route pinned items where they are pinned. For anything ambiguous it asks you, then saves your answer as a rule in **Routing memory**.
- **Write-back.** Routed lines get a mark such as `→ Thunk: routed (r:1a2b3c4d)`. The mark becomes `done`, `blocked` or `failed` when the project reports, and `done` ticks the box. Marked lines are never routed twice.
- **Daily triage.** The calendar button beside **Top level** schedules triage (weekdays at 08:30 by default, off until you turn it on), or runs it now. Triage sends every unrouted item to the routing session, asks for one routing plan per note, and has it write the day's summary to the top-level **Work log**. It skips the model turn when nothing is new.

The routing session (the code calls it the top chief; the UI badges it Relay) lives in an internal Home project (`~/.thunk/projects/__home/`). That project is left out of every project list, map and picker. Its routing plans and routes live in Postgres (`route_plans`, `routes`); an older `config/routing/state.json` is imported on startup and renamed to `state.json.imported`. Claude routing sessions cannot use Edit, Write, NotebookEdit or Bash; Codex top chiefs follow the rule through their prompt. Routing plans reuse the `delegation_plan` notification kind, so no migration is needed.

### Project notes and workspace links

Notes belong to projects. Use **Link workspace** at the top of a note to link it to one or more workspaces; once linked, that button names them. The Library's notebook list shows projects only, and a workspace's Notes tab is a filter over the same project notes. Unlinking, archiving, or removing a workspace does not delete its notes. Repo notebooks remain files in the project's registered repository folders.

Legacy workspace notes migrate into project storage on access, including notes belonging to archived workspaces. Migration preserves metadata, adds the original workspace link, updates task references, and uses stable IDs to avoid filename collisions. Old workspace note URLs continue to resolve while that workspace exists. Historical files already saved in the Granary stay there.

Workspace agent memory/task logs remain separate runtime state. Harvest copies selected lessons into project memory; deleting a workspace preserves nonempty logs in the Granary. Ordinary notes no longer require Harvest.

### Reviewable memory updates

The Harvest dialog offers two ways to keep what a workspace learned:

- **Add as is** appends the text you kept under a dated `## Harvested from <workspace> · <date>` heading, as before.
- **Propose an update** starts a short read-only session in the workspace. It reads the workspace task log, project memory, the sources sidecar, and the workspace's finished tasks with their worker reports, then calls the `memory_propose` tool. The proposal appears in the dialog and as a **Memory update** Decision in the Inbox, so you can close the dialog and review it later.

A proposal is a list of changes: **add** an entry, **replace** one, or **remove** one. Replace and remove name their `target`, the exact existing text. Each change shows its reason, its kind (**decision** or **workaround**) and its sources (task, session, note or workspace ids), with Accept, Edit and Reject. **Edit as document** opens the resulting MEMORY.md in the rich editor with added text highlighted, for edits the list can't express. **Apply** writes through the same expected-content check as the memory editor. If project memory changed since you opened the review, the changes are matched again by `target`: they apply if every accepted target is still there, and otherwise the ones that no longer match are flagged and nothing is written until you edit or reject them. A hand-edited document needs memory unchanged. Any session can call `memory_propose` (Claude through the `thunk` MCP server, Codex as a dynamic tool); a replace or remove whose target isn't in memory is refused, and nothing is written until you apply.

MEMORY.md stays plain markdown, because Claude's auto-memory reads it directly. Sources and kind live in a sidecar, `~/.thunk/projects/<slug>/memory/sources.json`, keyed by a hash of each entry's text. A replace carries the old entry's sources forward; a remove drops them. Workarounds get a `reviewAfter` date, 90 days out unless the proposal sets one.

**Memory upkeep** is a built-in routine template (New routine → Memory upkeep): weekly, Mondays at 09:00, and off until you switch it on. Its session reads the whole project memory and the sidecar and calls `memory_propose` with duplicates to merge, entries that contradict each other, workarounds past their `reviewAfter` date, and entries naming files or commands that no longer exist. Its result is the same Memory update card. A run with nothing to propose resolves quietly, with no card and no run notice; a run that proposed something shows only its card.

Proposals are stored in `memory_proposals` and `memory_proposal_items`. API: `GET /api/memory-proposals/[id]`, `POST …/apply` (`{ choices, memoryHash, document? }`), `POST …/reject`, and `POST /api/workspaces/[id]/harvest/propose` (`GET …?sessionId=` reports progress). The review screen is `/inbox/memory/[id]`. Run `node --conditions=react-server --test tests/memory-proposals.test.cjs` and `node --test lib/memory/compose.test.mjs`.
