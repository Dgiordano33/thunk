# Thunk

A personal Claude Code harness (Next.js 16.2 App Router + Electron desktop shell). Assistant turns become editable documents; projects, workspaces (git worktrees), sessions, notes, tasks, routines, vault and canvases hang off that. README.md is the user-facing reference; docs/ covers shipped features, plans/ unfinished ones.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

If `node_modules/next/dist/docs/` is missing, run `npm install` first. Middleware lives in `proxy.ts`.

## Commands

```bash
npm run dev          # binds 127.0.0.1 on $PORT (random if unset); Thunk sets $THUNK_PORT per workspace
npm run typecheck
npm run lint
npm test             # all node:test suites (lib + tests/ + component ui tests)
npm run test:tasks   # also: test:notes, test:routines, test:vault, test:board, test:lifecycle, test:notifications, test:desktop
npm run test:e2e     # Playwright; own dev server on :4517, build dir .next-e2e, in-memory DB. Needs `npx playwright install chromium` once
```

Run a single file: `node --conditions=react-server --test tests/<name>.test.cjs`

Before finishing: typecheck, lint, and the test suites for the area you touched.

## Tests

- No test framework or build step: tests are `node:test` `.cjs` files that transpile `.ts` on the fly with `typescript` and map `@/` to the repo root (see the top of any `tests/*.test.cjs`). Copy that preamble for new server tests.
- Server tests need `--conditions=react-server` (so `server-only` imports resolve). Pure lib tests are `lib/**/*.test.mjs` and run without it.
- `tests/helpers/test-db.cjs` gives an isolated database; never touch `~/.thunk` from tests.

## Architecture

- `app/(shell)`, `app/(world)`, `app/(legacy)` = route groups; `app/api/**` = route handlers (sessions stream over SSE with `since=`/`Last-Event-ID` replay).
- `lib/agent/` = one long-lived Agent SDK `query()` per session, pinned to `globalThis` so HMR doesn't orphan subprocesses. Keep that pattern for any long-lived process.
- `lib/store/session-store.ts` = the single event reducer for live SSE and DB hydration.
- `lib/{notes,tasks,routines,vault,board,workers,notifications,projects}/` = feature services. Files marked client-safe (e.g. `lib/routines/types.ts`, `lib/notes/frontmatter.ts`) must not import server code.
- `lib/db/` + `db/migrations/` = Postgres (embedded PGlite by default, `DATABASE_URL` optional, `THUNK_DATABASE=memory` for tests).
- `desktop/` = Electron shell (CommonJS). `instrumentation.ts` starts the routine scheduler.
- On-disk state lives under `~/.thunk` (or `$THUNK_DATA_DIR`), not in the repo.

## Gotchas

- **Pushing/merging to `main` deploys to the live server**: it pulls every ~minute and restarts when idle. Don't push to `main` unless asked.
- **Migrations**: add `db/migrations/YYYYMMDDHHMMSS_NNNN_snake_name.sql` with the next number. They apply automatically on startup; never apply by hand or edit an applied one.
- **Desktop packaging**: new files in `desktop/` must be added to `files` in `desktop/builder.cjs` (and covered in `desktop/builder.test.cjs`), or they're missing from the packaged app.
- **One Thunk per database**: the scheduler and pollers run in every instance. Never point a dev server at production; use `npm run db:pull`.
- Native/runtime packages (`@anthropic-ai/claude-agent-sdk`, `node-pty`, PGlite, `pg`) are in `serverExternalPackages`; keep new native deps there too.
- Server builds use `.next-a`/`.next-b` slots with their own tsconfigs. Don't remove those entries from `tsconfig*.json`.

## UI

Read `design.md` before UI work and `PRODUCT.md` for product intent. Two looks (solar system default, game world): style for `space` first, add `world:` variants, use the status tokens / `StatusBadge` rather than Tailwind palette colors, and use plain product terms outside the game map.

## Conventions

- Commit subjects: imperative sentence case describing the user-visible change ("Remove the Canvas heading from the sidebar"). Explain the why in the body.
- Update README.md or docs/ when you change user-visible behavior; move plans/ docs to docs/ once shipped.
