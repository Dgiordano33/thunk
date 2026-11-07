# Thunk

A personal Claude Code harness where assistant responses aren't chat bubbles: each turn's final prose becomes an editable document. Edit it directly, highlight spans to comment or ask questions, then **Send revisions**. Claude receives a unified diff, the quoted comment threads, and the full edited document, and replies with a revised version (v2, v3, …). Plans from plan mode use the same flow: edit or comment, then **Request changes** or **Approve**.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase keys (optional)
npm run dev
```

- **Auth:** set `ANTHROPIC_API_KEY`, or leave it empty to use your local `claude` login.
- **Persistence:** with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, sessions, documents, and comments survive restarts and can be resumed (SDK `resume`). Without them, sessions live in memory. Schema: `supabase/migrations/`.

## How it works

- `lib/agent/`: one long-lived `query()` per session (streaming input via `AsyncQueue`), pinned to `globalThis` so HMR doesn't orphan subprocesses. `event-bridge.ts` turns SDK messages into `HarnessEvent`s; `permissions.ts` parks `canUseTool` calls (tool approvals, `AskUserQuestion`, `ExitPlanMode`) until the UI answers. Sessions load the workspace's CLAUDE.md and `.claude/settings*.json`, but not `~/.claude`.
- `app/api/sessions/[id]/stream`: SSE with `since=<seq>` / `Last-Event-ID` replay. POST routes handle input, permissions, answers, plan decisions, and control (interrupt, model, mode, close).
- `lib/store/session-store.ts`: a single event reducer, used for both live SSE and hydrating from Supabase.
- `components/canvas/`: TipTap editor per document. Comments are a `comment` mark, so anchors move with edits. Diffs run against the editor's own round-tripped markdown, so untouched documents show zero edits.
- `lib/revisions/build-payload.ts`: the `<document_revision>` message format.

Keyboard: `⌘⌥M` comment on selection, `⌘↵` send revisions (in a document), `Esc` interrupt.
