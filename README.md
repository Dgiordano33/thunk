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

- **Notes** = a notebook per project (`~/.thunk/projects/<slug>/notes/<id>.md`) and per workspace (`…/workspaces/<slug>/notes/<id>.md`). Each note is markdown with frontmatter (`title`, `pinned`, `inject`, `actionable`, `tags`, `created`, `updated`). MEMORY.md shows up as the pinned first note of each scope. Every session gets both notes dirs as readable/writable directories and a `# Thunk notes` block in its system prompt: an index of notes plus the full text of `inject: true` notes (capped at 24k chars). Unchecked `- [ ]` items in `actionable: true` notes appear as tasks you can send to a session. A file watcher streams changes (including agent edits) to the UI over SSE.

Pages: `/` projects · `/p/[id]` project (workspaces, notes in the Library building, other Claude Code transcripts on disk for this repo that you can import) · `/w/[id]` workspace (sessions, git status, Notes tab with tasks) · `/s/[id]` session · `/notes` the Library (every notebook; `?scope=p:<id>|w:<id>&note=<id>`).

Notes API: `GET/POST /api/{projects|workspaces}/[id]/notes`, `GET/PATCH/DELETE …/notes/[noteId]` (`memory` is the MEMORY.md note: markdown edits only, not deletable), `GET …/notes/tasks`, `GET /api/notes` (all notebooks), `GET /api/notes/events` (SSE).

Retune's visual editor is available in development. Press `⌥D` (Alt+D) to toggle editing. The project `.mcp.json` configures its local MCP server for compatible agents; other clients can use `npx --no-install retune` from the project root. Restart your agent to load the configuration, or use Retune's clipboard output to apply edits. See the [Retune docs](https://github.com/khadgi-sujan/retune).

## How it works

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
