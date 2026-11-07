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
- **Memory files:** always on disk under `~/.thunk` (override with `THUNK_DATA_DIR`), with or without Supabase.

## Hierarchy

- **Project** = a git repo (its toplevel, even when added from a worktree) or a plain folder. Owns `CLAUDE.md` / `.claude/` config and a **project memory** file at `~/.thunk/projects/<slug>/memory/MEMORY.md`, injected into every session's system prompt and editable by agents and from the project page.
- **Workspace** = a task inside a project. Either works in place (the `main` workspace every project gets) or in its own **git worktree** at `<repo>/.claude/worktrees/<slug>` on a new branch (default `thunk/<slug>`, from `origin/<default>`). Has a **workspace memory** directory (`~/.thunk/projects/<slug>/workspaces/<slug>/memory/`) that is the SDK auto-memory dir for every session in it, so sessions share notes. Archive closes its live sessions; delete can also remove the worktree and memory.
- **Session** = one chat in a workspace. Runs with `cwd` = workspace dir and, in a worktree, `projectConfigRoot` = the main checkout so config comes from the trusted tree.

Pages: `/` projects · `/p/[id]` project (workspaces, project memory, other Claude Code transcripts on disk for this repo that you can import) · `/w/[id]` workspace (sessions, git status, workspace memory) · `/s/[id]` session.

Retune's visual editor is available in development. Press `⌥D` (Alt+D) to toggle editing. The project `.mcp.json` configures its local MCP server for compatible agents; other clients can use `npx --no-install retune` from the project root. Restart your agent to load the configuration, or use Retune's clipboard output to apply edits. See the [Retune docs](https://github.com/khadgi-sujan/retune).

## How it works

- `lib/projects/`: project detection (`git.ts`), worktree create/remove/status, memory file paths (`paths.ts`), and the project/workspace service (`index.ts`) incl. importing external SDK sessions via `listSessions({ dir, includeWorktrees })`.
- `lib/agent/`: one long-lived `query()` per session (streaming input via `AsyncQueue`), pinned to `globalThis` so HMR doesn't orphan subprocesses. `event-bridge.ts` turns SDK messages into `HarnessEvent`s; `permissions.ts` parks `canUseTool` calls (tool approvals, `AskUserQuestion`, `ExitPlanMode`) until the UI answers. Sessions load the workspace's CLAUDE.md and `.claude/settings*.json`, but not `~/.claude`.
- `app/api/sessions/[id]/stream`: SSE with `since=<seq>` / `Last-Event-ID` replay. POST routes handle input, permissions, answers, plan decisions, and control (interrupt, model, mode, close).
- `lib/store/session-store.ts`: a single event reducer, used for both live SSE and hydrating from Supabase.
- `components/canvas/`: TipTap editor per document. Comments are a `comment` mark, so anchors move with edits. Diffs run against the editor's own round-tripped markdown, so untouched documents show zero edits.
- `lib/revisions/build-payload.ts`: the `<document_revision>` message format.

Keyboard: `⌘⌥M` comment on selection, `⌘↵` send revisions (in a document), `Esc` interrupt.
