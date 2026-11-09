# Thunk for Mac: desktop app plan

Status: proposal · Author: Dan Giordano · Date: 2026-11-07

## Goal

Ship Thunk as a signed, notarized macOS app that installs by drag-to-Applications, needs no Node or terminal, keeps agents alive in the dock, and adds the native capabilities a browser can't give: notifications, dock badge, native dialogs, menu bar, deep links, and an integrated terminal.

Non-goals for v1: Windows/Linux, multi-window, auto-update server infrastructure beyond GitHub Releases, replacing the web dev workflow (`npm run dev` must keep working).

## Why this is tractable

The app is already desktop-shaped:

- Everything runs on the user's machine. The API is loopback-only (`proxy.ts`), agents spawn a local `claude` (or `codex`) binary over stdio, memory lives under `~/.thunk`.
- The folder picker already shells out to AppleScript (`app/api/fs/pick-folder/route.ts`), i.e. the app assumes it owns the machine.
- Persistence sits behind one clean boundary: `lib/supabase/repo/*` (five files, ~25 exported functions) and `lib/supabase/server.ts`. Nothing outside that reads Supabase directly.
- Live sessions are pinned to `globalThis` (`lib/agent/session-registry.ts`), so a single long-lived server process is already the model.

## Architecture

```
Thunk.app
├── Electron main process
│   ├── spawns:  node server.js  (Next standalone build, loopback, random port, auth token)
│   ├── owns:    BrowserWindow → http://127.0.0.1:<port>
│   ├── bridges: dialogs, notifications, badge, menu, shortcuts, deep links, pty
│   └── on quit: closes every live session, kills server
├── preload.ts  → window.thunk (typed IPC surface, contextIsolation on)
└── resources/
    ├── standalone/    (next build output: .next/standalone + static + public)
    └── node           (Electron's own node via ELECTRON_RUN_AS_NODE=1; nothing bundled)
```

Decision: **Electron, not Tauri.** The server is Node and the Agent SDK is Node. Tauri would need a Node sidecar anyway and gives back only bundle size. Electron ships the runtime we need.

Decision: **keep Next as the UI and API.** No rewrite to IPC-only. Routes, SSE, the Zustand store, TipTap, and git integration are untouched. The renderer talks to the server exactly as the browser does today; Electron adds a small `window.thunk` bridge for native-only things.

## Workstreams

Ordered by dependency. Each is independently mergeable and leaves `npm run dev` working.

### 1. Persistence: SQLite replaces Supabase (prerequisite)

A desktop app cannot ask users for a hosted Postgres and a service-role key, and "memory-only" mode loses sessions on quit.

- Add `lib/db/` with `better-sqlite3` (or `node:sqlite` once Electron's Node is ≥ 22.5; check at implementation time). Database file at `<DATA_DIR>/thunk.db`, next to the memory files that already live there.
- Port the two migrations in `supabase/migrations/` to SQLite DDL. Run migrations on startup from an embedded array; no CLI.
- Reimplement every export in `lib/supabase/repo/{projects,workspaces,sessions,messages,documents}.ts` against SQLite with identical signatures. Move the files to `lib/db/repo/` and update imports. Delete `lib/supabase/`, `@supabase/supabase-js`, and the `hasSupabase` branches (7 call sites).
- Keep `SUPABASE_*` out of `lib/env.ts`. Persistence is always on.
- `next.config.ts`: add `better-sqlite3` to `serverExternalPackages`. Rebuild native module against Electron's ABI in the packaging step (`electron-rebuild`).

Acceptance: fresh clone, no `.env.local`, `npm run dev` → create project, workspace, session, quit, relaunch, session resumes.

### 2. Binary and PATH resolution

GUI apps on macOS inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). `claude`, `codex`, `git`, `gh`, `node` installed via Homebrew, nvm, or npm -g will not be found. This is the first bug every app in this category hits.

- Add `lib/system/path.ts`: on server start, run the user's login shell once (`$SHELL -ilc 'echo -n $PATH'`, 3 s timeout) and merge into `process.env.PATH`. Cache the result.
- Resolve `claude` explicitly and pass `pathToClaudeCodeExecutable` in `lib/agent/options.ts` rather than relying on PATH at spawn time. Same for `CODEX_BIN`.
- Settings screen (workstream 5) shows the detected paths and lets the user override them.
- Fail loudly: if `claude` is missing, the new-session form shows an install prompt instead of a cryptic stderr tail.

### 3. Electron shell

- `electron/main.ts`, `electron/preload.ts`, `electron/server.ts`. Build with `electron-vite` or plain `tsc`; package with `electron-builder`.
- `next.config.ts`: `output: "standalone"`. Add `npm run build:desktop` that runs `next build`, copies `.next/standalone`, `.next/static`, and `public` into `resources/standalone`, then `electron-builder --mac`.
- Server launch: pick a free port, generate a per-launch token, set `THUNK_TOKEN`, `THUNK_DATA_DIR` (default `app.getPath("userData")`), `PORT`, `HOSTNAME=127.0.0.1`. Wait for `/api/health` (new route) before showing the window. Show a splash or a hidden window until ready.
- Auth hardening: `proxy.ts` additionally requires `x-thunk-token` (or a cookie set once by the main process) when `THUNK_TOKEN` is set. Any other local process can no longer drive agents in `bypassPermissions` mode. Dev mode without the token behaves as today.
- Dev mode: `npm run dev:desktop` points the window at `next dev` on 127.0.0.1:3000 so HMR keeps working.
- Lifecycle: `before-quit` → POST `/api/sessions/close-all` (new) → wait up to 5 s → kill server. `will-quit` kills orphans by process group.
- Window state persisted (size, position). Single instance lock.

### 4. Native bridge

Small, typed IPC surface in `preload.ts`, exposed as `window.thunk`. The web app feature-detects it; absence means browser mode.

| Capability | Replaces / adds |
|---|---|
| `pickFolder()` | AppleScript route; use `dialog.showOpenDialog` |
| `notify({ title, body, href })` | New. Fired by the session store on `awaiting` (permission, AskUserQuestion, plan) and on turn complete when window is not focused. Click focuses the window and navigates. |
| `setBadge(count)` | New. Number of sessions awaiting input. |
| `openExternal(url)` | PR links, GitHub |
| `onDeepLink(cb)` | `thunk://w/<id>`, `thunk://s/<id>`. Register `thunk` scheme. |
| Menu | File → New project / New workspace / New session; Edit (native copy/paste/undo must exist for TipTap); View → toggle comments panel, zoom; Window |
| Global shortcut | ⌘⇧T: show window and jump to the first session awaiting input |

Drag a folder onto the dock icon → `open-file` → add project.

### 5. First-run and settings

- Settings page at `/settings` (works in browser too). Fields: default model, permission mode default, `claude` path, `codex` path, data directory, API key (optional; stored in macOS Keychain via `keytar`/`safeStorage`, never in a file). Replace `.env.local` for desktop; env vars still win when present.
- First run: detect `claude`; if missing show install instructions; if present and no API key, confirm the local `claude` login works (`claude --version` plus a 1-token ping).

### 6. Integrated terminal

Depends on workstream 3. `node-pty` is already in `serverExternalPackages`, so this was anticipated.

- Spawn ptys from the Electron main process, not the Next server, so they survive server restarts and get the resolved PATH. Stream over IPC to an `xterm.js` panel in the workspace right panel as a fourth tab ("Terminal"), one pty per workspace, cwd = workspace dir.
- Later: a "Run" button that executes the project's configured run script here and surfaces the dev server URL.

### 7. Signing, notarization, distribution

- Apple Developer ID, hardened runtime, entitlements: `com.apple.security.cs.allow-unsigned-executable-memory` is not needed; `allow-jit` is not needed. Child-process spawning needs no special entitlement outside the sandbox. Do **not** enable the App Sandbox; it would block arbitrary cwd and git.
- `electron-builder` with `notarize: true`, credentials via `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` in CI.
- Universal binary (arm64 + x64) or arm64-only for v1. Recommendation: arm64-only, halve the build matrix.
- GitHub Actions `release.yml`: on tag → build → notarize → upload DMG and zip to GitHub Releases. `electron-updater` reads from the same release for auto-update.

## Changes to existing code (summary)

| File | Change |
|---|---|
| `lib/supabase/**` | Replace with `lib/db/**` (SQLite) |
| `lib/env.ts` | Drop `SUPABASE_*`; add `THUNK_TOKEN`, `CLAUDE_BIN` |
| `proxy.ts` | Token check when `THUNK_TOKEN` set |
| `lib/agent/options.ts` | `pathToClaudeCodeExecutable`, merged PATH in `env` |
| `app/api/fs/pick-folder/route.ts` | Keep for browser mode; desktop uses bridge |
| `lib/store/session-store.ts` | Emit `awaiting` / `done` transitions to a notifier hook |
| `components/layout/app-sidebar.tsx` | Show awaiting-input indicator per workspace (drives badge count) |
| `next.config.ts` | `output: "standalone"`, externals for `better-sqlite3`, `node-pty` |
| `package.json` | `electron`, `electron-builder`, `better-sqlite3`, `xterm`; scripts `dev:desktop`, `build:desktop` |
| new `app/api/health/route.ts` | Readiness probe |
| new `app/api/sessions/close-all/route.ts` | Graceful shutdown |
| new `electron/` | Shell |
| new `app/(shell)/settings/page.tsx` | Settings |

## Risks

- **Native module ABI.** `better-sqlite3` and `node-pty` must be rebuilt for Electron's Node. Mitigation: `electron-rebuild` in `postinstall` for desktop builds, or `node:sqlite` to avoid one native dep.
- **Agent SDK subprocess under Electron.** The SDK spawns `claude` with `process.execPath` assumptions in some code paths. Verify early (workstream 3, day 1) that a session runs end to end inside the packaged app; if not, set `executable: "node"` and `executableArgs` explicitly.
- **Startup latency.** Next standalone cold start is ~1 s. Acceptable with a splash; measure.
- **Bundle size.** Expect 150–200 MB. Acceptable for this category (Conductor, Cursor are larger).
- **Keychain prompts.** `safeStorage` avoids the per-app Keychain ACL prompt that `keytar` triggers after re-signing. Prefer `safeStorage`.

## Sequencing and estimate

| Phase | Workstreams | Estimate | Exit criterion |
|---|---|---|---|
| A | 1, 2 | 3–4 days | Browser app runs with SQLite, no `.env.local`, finds `claude` from a GUI-launched shell |
| B | 3 | 2–3 days | Unsigned `.app` launches, runs a session, quits cleanly |
| C | 4, 5 | 3–4 days | Notifications, badge, dialogs, settings, first-run |
| D | 7 | 1–2 days first time | Notarized DMG on GitHub Releases, auto-update works |
| E | 6 | 3–4 days | Terminal tab per workspace |

Roughly three weeks of focused work to a shippable v1 without the terminal, four with it. Phase A is worth doing even if the desktop app is shelved: it removes the Supabase dependency and the PATH foot-gun for browser users too.

## Open questions

1. Do we keep browser mode as a supported way to run Thunk, or does it become dev-only? (Recommendation: supported but second-class; it costs nothing to keep.)
2. Multi-provider: `CODEX_BIN` already exists. Should the first-run flow detect Codex too? (Recommendation: yes, same code path as `claude` detection.)
3. Telemetry/crash reporting: none today. Sentry in the Electron main process only, opt-in? Decide before Phase D.
