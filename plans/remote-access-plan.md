# Remote access and cloud host plan

Goal: use Thunk from a phone over Tailscale, then move the whole instance to an always-on VM that signs in with the existing Claude and Codex subscriptions. Apple Notes is out of scope.

Thunk stays a single-user, single-host app. No multi-tenant auth, no distributed workers.

## What the code looks like today

| Area | Current state | Consequence |
|---|---|---|
| Access boundary | `proxy.ts` allows only loopback `Host` and `Origin`, and only matches `/api/*` | Pages are unguarded; they are safe only because `next dev/start` binds `127.0.0.1` |
| Agents | Claude via Agent SDK (`lib/agent/options.ts`), Codex via `codex app-server` (`lib/agent/codex/rpc.ts`); both inherit `process.env` and the host's CLI logins | Portable to Linux as long as the logins exist on the host |
| Preview | `lib/projects/runtime.ts` returns `http://127.0.0.1:<port>` | Dead link from any other device |
| Folder picker | `app/api/fs/pick-folder` shells out to `osascript` for local clients; remote clients and non-macOS hosts use the in-page browser over `GET /api/fs/list` | Done |
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

## Phase 3: run on a DigitalOcean Droplet

Phases 1 and 2 are done. Thunk moves to an always-on Droplet that is reachable only over the tailnet. The Mac becomes a client.

### Step 0: prove the host (no Thunk code)

1. Droplet: Ubuntu 24.04 LTS, Basic Regular, 4 vCPU and 8 GB (about $48/mo) or 8 vCPU and 16 GB (about $96/mo), in the region closest to you. Several agent sessions plus a dev server and `next build` need the memory. Enable weekly Droplet backups.
2. Add an SSH key only for first boot. Install Tailscale, run `tailscale up --ssh`, and confirm `ssh <droplet>` works over the tailnet.
3. Attach a DigitalOcean Cloud Firewall with no inbound rules. Tailscale needs outbound only, so SSH and every other port are closed to the internet from then on. Recovery is the Droplet console in the DigitalOcean dashboard.
4. Install Node 24, `git`, `gh`, `codex`, the `claude` CLI and `build-essential` (for `node-pty`).
5. Sign in:
   - Claude: `claude setup-token`, stored as `CLAUDE_CODE_OAUTH_TOKEN` in the env file. Fallback is `ANTHROPIC_API_KEY`.
   - Codex: `codex login --device-auth`.
   - GitHub: a fine-grained token scoped to the repos Thunk uses, then `gh auth setup-git`.
6. Exit check: one headless Agent SDK turn and one Codex turn succeed on the Droplet. This settles the headless sign-in open question. Stop here if it fails.

### Step 1: host-independence fixes (testable on the Mac)

- Done: folder picker. `GET /api/fs/list?path=` (directories only, under the home dir) and a browser dialog with a text field; `osascript` stays the shortcut for a browser on the host.
- Done: Reveal in Finder is hidden for clients that are not on the host (covers a Linux host too, since every client is remote there).
- `tildify`: use the server's home dir instead of `/Users/<name>`.
- Preview: add `THUNK_PREVIEW_BASE`; when set, return `https://<host>:<port>` and run `tailscale serve --https=<port> localhost:<port>` on Run, removing it on stop.

### Step 2: deployment (done: [docs/server.md](../docs/server.md))

- `scripts/server/setup.sh`: idempotent; writes `/etc/thunk.env` defaults, the systemd unit, sudoers for the service, and the `thunk` command.
- systemd unit: `next start`, user `danielgiordano`, `Restart=always`, `HOSTNAME=127.0.0.1`, `PORT=4600`, `EnvironmentFile=/etc/thunk.env`.
- `tailscale serve --bg --https=443 http://127.0.0.1:4600`; `THUNK_TRUSTED_HOSTS=<droplet>.<tailnet>.ts.net`, `THUNK_TRUSTED_USER` unchanged.
- `thunk update [branch]` (`scripts/server/thunk`): builds into the idle of `.next-a`/`.next-b`, then restarts; `thunk rollback` swaps back.
- `docs/server.md` with all of the above.

### Step 3: data cutover

Recommended: keep absolute paths. The server user is `danielgiordano` with home `/Users/danielgiordano`, so Supabase paths and `data_key` stay valid.

1. Stop Thunk on the Mac.
2. rsync `~/.thunk` and the repo checkouts to the same paths on the Droplet, excluding `node_modules` and `.next*`.
3. Run `npm ci` in every checkout (Mac native modules do not run on Linux).
4. Point the Droplet at the existing Supabase project and start it.
5. Do not start the Mac server again on the same data. Two instances double-fire the scheduler and delivery polling.

Fallback: a fresh Supabase project, repos re-added by GitHub URL, and notes, memory and vault copied by hand.

### Step 4: operations

- Weekly Droplet backups (Step 0) plus a nightly copy of `THUNK_DATA_DIR` to DigitalOcean Spaces or another off-box target.
- Restarts kill live agents and PTYs. Routines marked interrupted recover on start; sessions resume manually. Running terminals in tmux can come later.
- Edit code by hand with Remote-SSH (VS Code or Cursor) over the tailnet, or by pushing and pulling.

## Order and size

| Phase | Depends on | Rough size |
|---|---|---|
| 1. Tailscale access | none | 0.5–1 day |
| 2. Mobile surface | 1 | 2–3 days |
| 3. DigitalOcean Droplet | 1 | 2–3 days |

Phase 1 alone gives phone access while the Mac is awake. Phases 2 and 3 are independent of each other.

## Open questions

- Subscription terms: Anthropic's help page says signed-in Agent SDK use draws from subscription limits and names no restriction. `claude setup-token` is the headless path; Step 0 confirms it works before any code is written.
- Agents on the Droplet run with the `thunk` user's full access. Decide whether `bypassPermissions` stays available when remote. The blast radius is the Droplet, not the Mac.
- Dev-server previews that hard-code `localhost` in redirects or asset URLs will not work through Serve.
