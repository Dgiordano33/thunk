# Remote access and cloud host plan

Goal: use Thunk from a phone over Tailscale, then move the whole instance to an always-on VM that signs in with the existing Claude and Codex subscriptions. Apple Notes is out of scope.

Thunk stays a single-user, single-host app. No multi-tenant auth, no distributed workers.

## What the code looks like today

| Area | Current state | Consequence |
|---|---|---|
| Access boundary | `proxy.ts` allows only loopback `Host` and `Origin`, and only matches `/api/*` | Pages are unguarded; they are safe only because `next dev/start` binds `127.0.0.1` |
| Agents | Claude via Agent SDK (`lib/agent/options.ts`), Codex via `codex app-server` (`lib/agent/codex/rpc.ts`); both inherit `process.env` and the host's CLI logins | Portable to Linux as long as the logins exist on the host |
| Preview | `lib/projects/runtime.ts` returns `http://127.0.0.1:<port>` | Dead link from any other device |
| Folder picker | `app/api/fs/pick-folder` shells out to `osascript`; `FolderPicker` has no text fallback | Cannot add a repo on Linux, or from a phone |
| Reveal in Finder | `app/api/workspaces/[id]/reveal` is darwin-only | Needs hiding off macOS |
| Paths | Supabase rows hold absolute paths; `data_key` is derived from the project root; `tildify` assumes `/Users/` | Existing Mac data does not move to a VM as-is |
| State | `~/.thunk` on disk, Supabase optional, live sessions and PTYs in process memory | Needs a persistent disk; restarts kill running agents |
| Mobile | About 17 responsive class usages across `app/` and `components/` | Desktop layout only |
| Linux | `scripts/prepare-pty.mjs` is platform-generic; `gh`, `git`, `codex` are found on `PATH` | No known blocker, untested |

## Phase 1: private access over Tailscale (Mac stays the host)

Keep Thunk bound to `127.0.0.1`. Tailscale Serve terminates HTTPS and proxies to it.

1. `proxy.ts`: add `THUNK_TRUSTED_HOSTS` (comma-separated, e.g. `mac.tailnet.ts.net`). Accept a request when `Host` is loopback or listed, and `Origin` is absent, loopback or listed. Default stays loopback-only.
2. For non-loopback hosts, require the `Tailscale-User-Login` header to equal `THUNK_TRUSTED_USER`. Serve strips client-supplied copies of this header, so it is trustworthy while Thunk listens on loopback only.
3. Widen the matcher from `/api/:path*` to all routes except static assets, so pages get the same check.
4. Add `THUNK_TRUSTED_HOSTS` and `THUNK_TRUSTED_USER` to `lib/env.ts`, `.env.local.example` and `docs/desktop.md`.
5. Tests: extend the origin-protection checks (`scripts/smoke-desktop.mjs` and a new `tests/proxy.test.cjs`) for trusted host, wrong user, missing header, foreign origin, DNS-rebinding host.
6. Run `tailscale serve --bg --https=443 localhost:<port>` and confirm SSE streams (session, terminal, notes) work through it.

Check first: the Host header Serve forwards is not documented. Log it once before writing the allowlist logic.

Read `node_modules/next/dist/docs/` on `proxy` before editing (per `AGENTS.md`).

## Phase 2: mobile surface

See [Mobile-friendly Thunk](mobile-plan.md) for the mobile layout and verification plan. It can be developed with emulated viewports before Phase 1 enables remote access.

## Phase 3: run on a VM

1. Host-independence fixes
   - Folder picker: add `GET /api/fs/list?path=` (directories only, under the home dir) and a browser dialog with a text field; keep `osascript` as the macOS shortcut.
   - Hide Reveal in Finder when the server is not darwin.
   - `tildify`: use the server's home dir instead of `/Users/<name>`.
   - Preview: add `THUNK_PREVIEW_BASE`; when set, return `https://<host>:<port>` and run `tailscale serve --https=<port> localhost:<port>` on Run, removing it on stop.
2. Deployment
   - Ubuntu VM with a persistent disk, Node 22.16+ or 24, `git`, `gh`, `codex`, Tailscale.
   - `npm ci && npm run build`, started by a systemd unit with `Restart=always`, `HOSTNAME=127.0.0.1`, and an env file.
   - Add `docs/server.md` with the unit file and an update script (`git pull`, build, restart).
3. Sign-ins on the VM
   - Claude: sign in with the official CLI flow. Fallback is `ANTHROPIC_API_KEY`.
   - Codex: `codex login --device-auth`, or copy `~/.codex/auth.json`.
   - GitHub: `gh auth login` plus `gh auth setup-git`.
4. Data
   - Start the VM on a fresh Supabase project and re-add repos by GitHub URL. Absolute paths and `data_key` make an in-place move fragile.
   - Optionally copy `~/.thunk/projects/*/notes`, `memory` and `vault` into the new keys by hand.
   - Run one instance only. Two instances on the same data double-fire the scheduler and delivery polling.
5. Operations
   - Nightly backup of `THUNK_DATA_DIR` and repo checkouts with unpushed work.
   - Restarts kill live agents and PTYs. Routines marked interrupted recover on start; sessions resume manually.

## Order and size

| Phase | Depends on | Rough size |
|---|---|---|
| 1. Tailscale access | none | 0.5–1 day |
| 2. Mobile surface | 1 | 2–3 days |
| 3. VM | 1 | 2–3 days |

Phase 1 alone gives phone access while the Mac is awake. Phases 2 and 3 are independent of each other.

## Open questions

- Subscription terms: Anthropic's help page says signed-in Agent SDK use draws from subscription limits and names no restriction; it does not cover headless sign-in. Confirm the sign-in flow on the VM before committing to Phase 3.
- Agents on the VM run with the VM user's full access. Decide whether `bypassPermissions` stays available when remote.
- Dev-server previews that hard-code `localhost` in redirects or asset URLs will not work through Serve.
