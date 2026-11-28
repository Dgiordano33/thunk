# Run Thunk on a server

Thunk can run around the clock on a Linux server, so you can use it from your phone or any computer without keeping your Mac awake. These steps use a DigitalOcean Droplet, but any Ubuntu 24.04 machine works. The server is reachable only over your private Tailscale network. Requests are checked the same way as in [Use Thunk from your phone](remote.md).

Pushing to the branch the server follows (normally `main` of the repo it was cloned from) is enough to deploy: the server picks up new commits within about one minute and switches to them once nothing is running. For everything else there is one command, `thunk`, which runs on the server.

Replace these placeholders with your own values throughout:

| Placeholder | What it is | Example |
|---|---|---|
| `<user>` | Your user on the server | `alex` |
| `<host>` | The server's Tailscale machine name | `thunk` |
| `<tailnet>` | Your tailnet's DNS name, shown in the Tailscale admin console under **DNS** | `tail1234.ts.net` |
| `<repo>` | The GitHub repo the server deploys from: upstream, or your fork | `Dgiordano33/thunk` |

The server's address is `https://<host>.<tailnet>`. `scripts/server/setup.sh` works out the user, address and Tailscale login on its own, so only the commands below need the placeholders.

## Deploying

A timer on the server checks GitHub every minute. When the checkout's branch (normally `main`) has new commits, it builds them beside the running version straight away. It restarts onto the new build only when no agent is working, no routine is running and no workspace is being set up or archived. Agents waiting for your answer, open terminals and Run previews do not hold it back; terminals and previews have to be reopened after the restart.

- `thunk status` shows what the server is doing (`Activity`) and whether automatic updates are on.
- `thunk auto` lists recent automatic updates, including "waiting to restart: 1 agent working".
- `thunk update` deploys right away without waiting.
- `thunk auto off` and `thunk auto on` turn automatic updates off and on.
- After `thunk rollback`, automatic updates pause until you run `thunk update main`. A commit whose build fails is not retried until the next commit lands.
- If `package-lock.json` changed, the whole update waits for an idle moment, because reinstalling dependencies stops Thunk for a few minutes.

Every pull request and every push to `main` runs the `ci` workflow (`.github/workflows/ci.yml`): typecheck, lint and `npm test`. With branch protection on `main` requiring `ci`, a PR that breaks them cannot merge and so cannot deploy. Pushing to `main` directly skips that gate. A separate `e2e` job runs the Playwright tests; it is not required yet.

## Everyday use

Connect from your Mac. There is no password; Tailscale handles sign-in, and the first connection of the day may open a browser to confirm:

```sh
ssh <user>@<host>
```

On the server:

| Command | What it does |
|---|---|
| `thunk status` | Whether Thunk is running, which version, what it is doing, and its address |
| `thunk update` | Get the latest code, build it and restart now |
| `thunk update <branch>` | Switch to a branch, then build and restart. `thunk update main` goes back |
| `thunk rollback` | Go back to the version before the last update, in seconds. Pauses automatic updates |
| `thunk auto` | Show recent automatic updates. `thunk auto off` / `thunk auto on` |
| `thunk logs` | Follow the server log. Press `Ctrl-C` to stop |
| `thunk restart`, `thunk stop`, `thunk start` | Control the service |
| `thunk env` | Edit settings in `/etc/thunk.env`, then restart |
| `thunk doctor` | Check the Claude, Codex and GitHub sign-ins, data, Serve, disk and memory |

A manual restart or update stops running agents and terminals, so use it when nothing is running. Routines that were interrupted recover on their own; sessions can be resumed by hand.

A session whose agent has ended stays in server memory until nobody has had it open for 30 minutes; then it is dropped (checked every 10 minutes). Opening it again shows its history from the database, and Resume picks it up where it stopped. With no database (memory-only mode) ended sessions stay in memory. Usage totals read a per-turn table (`usage_results`) instead of every stored message.

`thunk update` builds the new version beside the running one and switches over only when the build succeeds. A failed build leaves the running version alone. The only time Thunk stops during an update is when `package-lock.json` changed and dependencies have to be reinstalled.

### Open it in the Mac app

Set `THUNK_REMOTE_URL=https://<host>.<tailnet>` in the desktop app's configuration and reopen it. The app then opens the server in its own window and starts nothing locally; see [Use a Thunk server instead](desktop.md#use-a-thunk-server-instead).

### From the Mac without logging in

Add this to `~/.zshrc` on the Mac:

```sh
alias thunk-vm='ssh -t <user>@<host> thunk'
```

Then run any command from your Mac, for example `thunk-vm update` or `thunk-vm logs`.

## Where things are

| What | Where |
|---|---|
| Thunk server checkout | `~/thunk-server`. If you also work on Thunk itself from this server, keep that project in a separate clone, where agents edit code |
| Project repos | Wherever you clone them, for example `~/code/...`. See [Same paths as your Mac](#optional-same-paths-as-your-mac) |
| Settings and secrets | `/etc/thunk.env`; edit with `thunk env` |
| Builds | `.next-a` and `.next-b` in the server checkout; one is live. `~/.config/thunk/` records which |
| Automatic updates | `thunk-autoupdate.timer` and `thunk-autoupdate.service` in `/etc/systemd/system/`; log with `thunk auto` |
| Memory, notes and vault files | `~/.thunk` |
| Connectors shared by every project | `~/.thunk/config/mcp.json`; see [Browser tools](#browser-tools) |
| Service definition | `/etc/systemd/system/thunk.service`, written by `scripts/server/setup.sh` |
| Logs | `thunk logs`, or `journalctl -u thunk` |

Settings in `/etc/thunk.env`:

```dotenv
PORT=4600
THUNK_TRUSTED_HOSTS=<host>.<tailnet>   # filled in by setup.sh
THUNK_TRUSTED_USER=you@example.com     # your Tailscale login, filled in by setup.sh
CLAUDE_CODE_OAUTH_TOKEN=...            # from `claude setup-token`
# DATABASE_URL=postgres://...          # optional; see "Keep your data"
```

## Keep your data

Projects, workspaces, sessions, tasks and routines are kept in an embedded database in `~/.thunk/db`, beside the memory, notes and vault files, so they survive restarts and updates with no setup. Thunk backs all of it up every day; see [Backups](#backups). The Droplet's weekly backups also include `~/.thunk`.

To use your own Postgres instead, such as Supabase, add `DATABASE_URL` with `thunk env`. For Supabase, copy the **Session pooler** string from **Connect** in the dashboard; Supabase's direct connection is IPv6-only unless you add its IPv4 add-on. Do not point the server and the Mac at the same database while both are running: both would run the scheduler and delivery polling.

**Upgrading a server that used `SUPABASE_URL`.** Add `DATABASE_URL` with `thunk env` *before* deploying a version that needs it; older versions ignore it. A new version that finds only `SUPABASE_URL` keeps Thunk running but refuses to use any database, and `thunk doctor` shows `Data: NOT CONNECTED`. Remove the `SUPABASE_*` lines once `thunk doctor` shows `Database: ok`.

## Backups

Every day Thunk writes one archive, `~/.thunk/backups/thunk-<date>.tar.gz`, holding:

- `projects/`, `config/` and `homes/` from `~/.thunk`: notes, memory, Vault, canvases, connectors and settings.
- `db/<table>.jsonl`: every database table, read in one consistent snapshot. The format is the same for the embedded database and `DATABASE_URL`, so an archive from one restores into the other.
- `manifest.json`: when it was made, the Thunk commit, the last migration, and row and file counts.

Archives stay on the machine that runs Thunk. They protect against a bad write, a bad migration or a deleted project, not against losing the machine. To keep them elsewhere, point `dir` at a mounted volume.

**The archive includes `config/integrations.json`, which holds your Linear and Slack tokens.** Archives are written with mode 0600 (readable only by your user) in a folder with mode 0700. Treat a copied archive like a password file.

### Settings

In **Settings → Automation → Backups**: on or off, the time of day, how many to keep, when the last one ran and its size, and **Back up now**. They are stored in `~/.thunk/config/backup.json`:

| Setting | Default | What it does |
|---|---|---|
| `enabled` | `true` | Run the daily backup |
| `time` | `"03:00"` | Time of day, in `tz` (your browser's time zone when saved from Settings), else the server's |
| `keep` | `7` | Archives kept; older ones are deleted after each backup |
| `dir` | `~/.thunk/backups` | Where archives go; an absolute path. Edit the file to change it |

A backup missed while the server was off runs within a minute of starting. A failed backup shows its error in Settings and is retried an hour later. While the backup reads the embedded database (a few seconds), other database requests wait for it. A second Thunk that keeps its data in memory, because another one holds the database, does not back up.

### From the command line

```sh
cd ~/thunk-server
npm run data:backup                          # one archive now, then prune to `keep`
npm run data:backup -- --with-transcripts    # also ~/.claude/projects
```

When the server is running and holds the embedded database, `data:backup` asks it to make the backup over `http://127.0.0.1:$PORT`; set `PORT` if it isn't 4500 (`PORT=4600 npm run data:backup` on a default server). Claude transcripts are left out by default because messages are already in the database; only resuming an old session needs them.

### Restore

```sh
thunk stop
cd ~/thunk-server
npm run data:restore thunk-2026-11-27T03-00-00-000Z.tar.gz   # a name in the backups folder, or a path
thunk start
```

Restore refuses while a Thunk holds `~/.thunk/db/thunk.lock`, and refuses an archive from a newer Thunk than the checkout. It moves the current `~/.thunk` to `~/.thunk.before-restore-<date>` (the `backups/` folder comes back with it), unpacks the files, creates a fresh database and loads every table. With `DATABASE_URL`, the database's current rows are saved to `~/.thunk.before-restore-<date>/db/` first, and the tables are replaced in one transaction. Transcripts in the archive are merged into `~/.claude/projects` without overwriting newer files. If anything fails, the previous data is put back. Delete the `.before-restore` folder once Thunk looks right.

Routines come back as they were. Restoring a server's archive on a Mac (or the other way) while the original keeps running would fire them twice; turn them off on one side, or use `npm run db:pull` for a development copy.

## Browser tools

Agents in every project can open pages, click through them and take screenshots. `setup.sh` installs Chromium and writes `~/.thunk/config/mcp.json`, which holds connectors shared by all projects, in the same format as a project's **Connectors** setting. A project connector with the same name replaces the shared one. Changes apply to new sessions.

To add browser tools to a server set up before this existed, run `scripts/server/setup.sh` again from `~/thunk-server`. To change the pinned version, edit the file and run `npx -y @playwright/mcp@<version> install-browser chromium` so the matching Chromium is installed.

## Your Claude Code and Codex setup

By default, Claude sessions in Thunk load only the project's `CLAUDE.md` and `.claude/` settings, not your own `~/.claude`. Codex sessions always read `~/.codex/config.toml`. To give agents on the server the skills, plugins and MCP servers you use on your Mac, open the server in the Mac app ([Open it in the Mac app](#open-it-in-the-mac-app)) and choose **Settings → Agents → Sync from this Mac**, or **Thunk → Sync My Setup to Server** in the menu bar.

The sync goes over Thunk's own address, so it needs no SSH. Only files that changed are sent: the first sync is about 25 MB, later ones usually send nothing. It also turns on **Use my Claude Code setup in Claude sessions** in the same panel, and new sessions pick it up with no restart. Running sessions keep what they started with. Sync again whenever you add a skill, plugin or MCP server on the Mac. Each settings file it replaces is kept as `<file>.bak-<time>`.

Without the Mac app, run `npm run server:sync-config -- https://<host>.<tailnet>` from a Thunk checkout on the Mac. Add `--dry-run` to see what would be sent.

| Copied | Left out |
|---|---|
| `~/.claude/settings.json` (permissions, enabled plugins, model and effort) | Its `hooks` and `statusLine`, which call tools on the Mac |
| `~/.claude/skills`, with symlinked skills copied as files | `~/.claude/skills/synced` (claude.ai sync) |
| Enabled Claude plugins and the marketplaces they come from, without git history | Disabled plugins and unused marketplaces |
| MCP servers from `~/.claude.json` and `~/.codex/config.toml` that can run on Linux | Servers under `/Applications`, on `localhost`, disabled, or whose command the server lacks (the panel lists each with the reason) |
| Codex model settings, features, profiles, trusted projects, `AGENTS.md`, `~/.codex/skills` | Codex plugins, `notify`, and desktop-app settings |

Paths under your Mac's home folder are rewritten to the server's, so plugins work even when the home folders differ.

Sign-ins are never copied: not Claude, Codex or GitHub, and not MCP servers or plugins that sign in through a browser (Linear, Notion, Slack and the like show as needing sign-in). Connectors you use on claude.ai do not reach Thunk sessions either. For those, add a connector with an API key in a project's **Connectors** setting or in `~/.thunk/config/mcp.json`.

With the setup turned on, your `permissions.allow` rules apply in Thunk too, so the tools they allow run without an approval card. Thunk's own denies (vault originals and connector settings) still win.

The same checkbox works in the Mac app without a server: turn it on in **Settings → Agents** to load your `~/.claude` in local sessions. There, your hooks load as well.

## Sign-ins

Each sign-in is stored on the server. `thunk doctor` shows which ones work.

| Service | How to sign in again |
|---|---|
| Claude | `claude setup-token`, then put the token in `CLAUDE_CODE_OAUTH_TOKEN` with `thunk env` |
| Codex | `codex login --device-auth` |
| GitHub | Create a fine-grained token at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens), then `gh auth login --with-token` and `gh auth setup-git` |

## Troubleshooting

| Symptom | What to do |
|---|---|
| The page does not load on the phone | Check that Tailscale is on in the phone. Run `thunk status` on the server. |
| `thunk status` says `failed` or `not responding` | Run `thunk logs` and read the last lines. `thunk restart` often clears it. |
| A bad update | `thunk rollback` |
| `Forbidden` (403) | `thunk logs` shows a line starting with `[access] denied` with the reason; see [remote.md](remote.md#troubleshooting). |
| `ssh <user>@<host>` hangs | Tailscale is off on the Mac, or the server is down. In DigitalOcean, use **Access → Droplet Console** to get a shell and run `sudo tailscale up --ssh`. |
| `thunk logs` says permission denied | Log out and back in once after setup. |

## Build the server

This only needs to be done once, or again to rebuild the server from scratch.

### 1. Create the Droplet

In DigitalOcean, click **Create → Droplets**:

- **Image:** the **OS** tab, **Ubuntu 24.04 (LTS) x64**. Not a Marketplace image.
- **Size:** **Basic**, **Regular**, 4 vCPU / 8 GB or larger.
- **Authentication:** SSH key, from `~/.ssh/id_ed25519.pub` on the Mac.
- **Backups:** weekly.
- **Hostname:** `<host>`, for example `thunk`.

### 2. Tailscale and your user (as root)

```sh
ssh root@<droplet IP>
apt update && apt upgrade -y
apt install -y build-essential git curl unzip tmux
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh --hostname=<host>         # open the printed link on the Mac and approve

useradd -m -s /bin/bash <user>
usermod -aG sudo <user>
passwd <user>
```

Check that `ssh <user>@<host>` works from the Mac. Then, in DigitalOcean, open **Networking → Firewalls → Create Firewall**, delete every inbound rule, keep the outbound rules, and apply it to the Droplet. From then on, nothing on the server can be reached from the internet. Tailscale works through outbound connections only.

### 3. Tools (as `<user>`, over Tailscale)

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

sudo mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
sudo apt update && sudo apt install -y gh

sudo npm i -g @openai/codex
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Then sign in to Claude, Codex and GitHub as described in [Sign-ins](#sign-ins). Keep the Claude token for the next step.

### 4. Install Thunk as a service

```sh
gh repo clone <repo> ~/thunk-server && cd ~/thunk-server
scripts/server/setup.sh
thunk env              # paste CLAUDE_CODE_OAUTH_TOKEN=<token> if setup warned about it
thunk doctor
```

`setup.sh` fills in the Tailscale settings, builds Thunk, installs the `thunk` service so it starts on boot and restarts if it crashes, turns on automatic updates, starts Tailscale Serve, and adds the `thunk` command. It is safe to run again, for example after a change to `scripts/server/`.

To deploy your own changes, fork the repo and clone the fork here. The server follows whatever `origin` and branch the checkout has. To switch an existing server to a fork, run `git -C ~/thunk-server remote set-url origin https://github.com/<repo>.git`, then `thunk update`.

### Optional: same paths as your Mac

Thunk stores each project's absolute path. If you move data from a Mac to the server, or point both at the same database, give the server user the same home directory as on the Mac so those paths still resolve. In step 2, create the user with `mkdir -p /Users && useradd -m -d /Users/<user> -s /bin/bash <user>` instead, and clone repos to the same places as on the Mac. A server that starts with its own data does not need this.
