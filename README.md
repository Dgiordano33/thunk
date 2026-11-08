# Thunk

A personal Claude Code harness where assistant responses aren't chat bubbles: each turn's final prose becomes an editable document. Edit it directly, highlight spans to comment or ask questions, then **Send revisions**. Claude receives a unified diff, the quoted comment threads, and the full edited document, and replies with a revised version (v2, v3, …). Plans from plan mode use the same flow: edit or comment, then **Request changes** or **Approve**.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase keys (optional)
npm run dev
```

- **Auth:** set `ANTHROPIC_API_KEY`, or leave it empty to use your local `claude` login.
- **Persistence:** with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, projects, workspaces, sessions, documents, and comments survive restarts and sessions can be resumed (SDK `resume`). Without them, they live in memory. Schema: `supabase/migrations/`.
- **Memory and notes files:** always on disk under `~/.thunk` (override with `THUNK_DATA_DIR`), with or without Supabase.

## Hierarchy

- **Project** = a git repo (its toplevel, even when added from a worktree) or a plain folder. Owns `CLAUDE.md` / `.claude/` config and a **project memory** file at `~/.thunk/projects/<slug>/memory/MEMORY.md`, injected into every session's system prompt and editable by agents and from the project page.
- **Workspace** = a task inside a project. Either works in place (the `main` workspace every project gets) or in its own **git worktree** at `<repo>/.claude/worktrees/<slug>` on a new branch (default `thunk/<slug>`, from `origin/<default>`). Has a **workspace memory** directory (`~/.thunk/projects/<slug>/workspaces/<slug>/memory/`) that is the SDK auto-memory dir for every session in it, so sessions share notes. Archive closes its live sessions; delete can also remove the worktree and memory.
- **Session** = one chat in a workspace. Runs with `cwd` = workspace dir and, in a worktree, `projectConfigRoot` = the main checkout so config comes from the trusted tree.

- **Notes** = a notebook per project (`~/.thunk/projects/<slug>/notes/<id>.md`) and per workspace (`…/workspaces/<slug>/notes/<id>.md`). Each note is markdown with frontmatter (`title`, `pinned`, `inject`, `actionable`, `tags`, `created`, `updated`). MEMORY.md shows up as the pinned first note of each scope. Every session gets both notes dirs as readable/writable directories and a `# Thunk notes` block in its system prompt: an index of notes plus the full text of `inject: true` notes (capped at 24k chars). Checklists remain editable in notes; the legacy `actionable` flag is still read for importing old checklist items into Tasks. A file watcher streams changes (including agent edits) to the UI over SSE.

- **Routines** = standing orders for agents: a prompt, model and permission mode that start a session on a cron schedule, on **Run now**, or on events (a new GitHub PR, polled every ~2 min via `gh`; a workspace's Run script exiting non-zero; a local webhook `POST /api/routines/[id]/webhook?token=…`). Each run gets a fresh worktree by default (removed when nothing changed, archived otherwise) or runs in a chosen workspace. Prompts, questions and plans park the run as *Needs you*. When a run ends, its summary, diff stat, PR link and cost are recorded and a report note is written to the project's notebook. Guardrails: one run per routine, max runs/day (default 24), a per-run time limit (default 60 min), and at most 3 routine runs at once. **Routines fire only while the Thunk server is running**; runs open at shutdown are marked interrupted on the next start, and a missed schedule runs once on start if the routine asks to catch up.

- **Vault** = the project's source material. Upload docs, PDFs, images, slides (.docx/.pptx/.xlsx), transcripts or pasted text (25MB per file); Claude reads each one in the background (a tool-less one-shot Agent SDK call, so it works with your local `claude` login) and stores a summary, up to 12 ideas and tags beside the original under `~/.thunk/projects/<slug>/vault/<id>/`. Send any idea to the project notebook or make it a task. Agent sessions get read-only `vault_list` / `vault_read` tools and file access to the originals.

Pages: `/` projects · `/p/[id]` project (workspaces, notes in the Library building, other Claude Code transcripts on disk for this repo that you can import) · `/w/[id]` workspace (sessions, git status, Notes and Tasks tabs) · `/s/[id]` session · `/notes` the Library (every notebook; `?scope=p:<id>|w:<id>&note=<id>`) · `/routines` every routine (each town's Workshop holds its own: `/p/[id]?building=workshop`) · `/vault` every project's uploads (each town's Vault: `/p/[id]?building=vault&item=<id>`).

Vault API: `GET/POST /api/projects/[id]/vault` (multipart `file` and/or `text`), `GET/PATCH/DELETE …/vault/[itemId]` (`{title}` or `{reextract: true}`), `GET …/[itemId]/file` (`?download`), `POST …/[itemId]/promote` (`{ideaId, to: "note"|"task"}`), `GET /api/vault` (all projects).

Routines API: `GET/POST /api/routines` (`?projectId=`), `GET/PATCH/DELETE /api/routines/[id]`, `POST …/run`, `GET …/runs`, `DELETE …/runs/[runId]` (cancel), `POST …/webhook`.

Notes API: `GET/POST /api/{projects|workspaces}/[id]/notes`, `GET/PATCH/DELETE …/notes/[noteId]` (`memory` is the MEMORY.md note: markdown edits only, not deletable), `GET /api/notes` (all notebooks), `GET /api/notes/events` (SSE).

Retune's visual editor is available in development. Press `⌥D` (Alt+D) to toggle editing. The project `.mcp.json` configures its local MCP server for compatible agents; other clients can use `npx --no-install retune` from the project root. Restart your agent to load the configuration, or use Retune's clipboard output to apply edits. See the [Retune docs](https://github.com/khadgi-sujan/retune).

## Tasks

Tasks have stable IDs, status (open, in progress, blocked, done, cancelled), priority, optional markdown detail, due date, note link, and an owning session. Open the **Tasks** tab in a workspace (`/w/<id>?tab=tasks`) for workspace and project tasks, or the town's **Town hall** (`/p/<id>?building=tasks`) for the project's full list grouped by workspace. Sidebar badges show open counts and update live.

Enter a title to create a task; use ⌘↵ to add details. Open a task to edit its fields, or send it to an existing session or a new chat. Claude and Codex receive `tasks_list`, `tasks_create`, `tasks_update`, and `tasks_complete` tools and the current workspace/project open-task context. IDs may be full UUIDs or unambiguous prefixes. Codex threads created before task tools were added need a new session; newly created threads retain the tools when resumed.

Existing actionable notes are not migrated automatically. The workspace Tasks tab offers to import unchecked checklist items from workspace and project notes, preserving the note text and linking each imported task to its note.

Apply `supabase/migrations/20261110090000_0004_tasks.sql` for persistent storage. Without Supabase, tasks live in server memory and are lost on restart. Task events use an in-process SSE feed, like other local runtime features.

Tasks API: `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/[id]`, `POST …/[id]/send`, `GET /api/tasks/tree?projectId=…`, `GET /api/tasks/counts`, `GET /api/tasks/events`, and `GET/POST /api/tasks/import-notes`. Run `npm run test:tasks` for task checks.

## How it works

- `lib/routines/`: types, zod schema, cron helpers and prompt templating (client-safe), the scheduler (`scheduler.ts`, started from `instrumentation.ts`), runner, report, PR poller and event triggers.
- `lib/notes/`: note frontmatter parsing (`frontmatter.ts`, client-safe), file store (`store.ts`), scope → dirs (`resolve.ts`), the system-prompt block (`prompt.ts`), and the `fs.watch` feed (`watch.ts`).
- `lib/projects/`: project detection (`git.ts`), worktree create/remove/status, memory file paths (`paths.ts`), and the project/workspace service (`index.ts`) incl. importing external SDK sessions via `listSessions({ dir, includeWorktrees })`.
- `lib/agent/`: one long-lived `query()` per session (streaming input via `AsyncQueue`), pinned to `globalThis` so HMR doesn't orphan subprocesses. `event-bridge.ts` turns SDK messages into `HarnessEvent`s; `permissions.ts` parks `canUseTool` calls (tool approvals, `AskUserQuestion`, `ExitPlanMode`) until the UI answers. Sessions load the workspace's CLAUDE.md and `.claude/settings*.json`, but not `~/.claude`.
- `app/api/sessions/[id]/stream`: SSE with `since=<seq>` / `Last-Event-ID` replay. POST routes handle input, permissions, answers, plan decisions, and control (interrupt, model, mode, close).
- `lib/store/session-store.ts`: a single event reducer, used for both live SSE and hydrating from Supabase.
- `components/canvas/`: TipTap editor per document. Comments are a `comment` mark, so anchors move with edits. Diffs run against the editor's own round-tripped markdown, so untouched documents show zero edits.
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

## Town delivery status

Town centers show PR/check pennants (– draft, … running, ✓ passed, × failure/conflicts, ? unknown) and lit windows when their local dev server is running. Open a town center for its Delivery section: checks, reviews, agent hand-offs, Start/Stop dev server, and deployed/local preview links. Hover cards include branch divergence and uncommitted changes; divergence uses local refs and does not fetch origin.

The scheduler caches open PRs per project through `gh api graphql`, polling about every 60 seconds, or 10 seconds while checks are pending. Local Git/runtime status refreshes about every 10 seconds. GitHub failures retain the last result with an explicit warning and back off to 60 seconds. GitHub CLI authentication is required; folder projects and repositories without an origin still show local runtime status. Preview links come from successful deployments on the PR head commit; providers must publish GitHub Deployments for these links to appear.

PR lists are paginated. Each head includes up to 100 checks and the last 20 deployments; truncated check lists show an additional pending row linking to GitHub, never an all-green result. Delivery snapshots and the last 200 activity events per project persist in `~/.thunk/projects/<project>/delivery.json` (or `THUNK_DATA_DIR`). Town hover cards show the latest event; Delivery panels show the latest ten events for their branch. Events cover CI passing/failing, posted reviews, new review requests, successful deployments, and confirmed PR merges. Reviews inspect the latest 20 submissions and up to 100 outstanding requests. A missing open PR is checked separately before reporting a merge. First observations are quiet baselines; polling can miss transitions that begin and end between polls. Existing desktop notification opt-in applies to new delivery events while the app is open, without replaying history on page load.

Apply `supabase/migrations/20261111090000_0005_delivery_triggers.sql` before enabling delivery routines with Supabase. The Workshop routine form supports `ci_failed`, `review_requested` (a reviewer/team is requested, not a changes-requested decision), and `deploy_ready`. Prompts can use `{{event.pr.url}}`, `{{event.pr.branch}}`, `{{event.pr.head}}`, `{{event.checks}}`, `{{event.previewUrl}}`, or `{{payload}}`. Workspace targets match their current branch; fresh-worktree targets ignore `thunk/*` branches to prevent automation loops. Existing run limits still apply. Subscription changes and re-enabling a routine establish a new baseline; recovered CI and superseded commits are skipped.

Routine cursors are persisted in existing `trigger_state` storage before firing, matching the PR trigger's at-most-once policy: a crash between consumption and start can skip a job, and rejected jobs are not retried. With no Supabase, routines/cursors remain in memory; local delivery history still survives restarts. Run `node --conditions=react-server --test tests/delivery.test.cjs tests/delivery-history.test.cjs tests/routines.test.cjs` for delivery and routine checks.
