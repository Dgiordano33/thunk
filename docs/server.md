# Run Thunk on a server

Thunk can run around the clock on a Linux server, so you can use it from your phone or any computer without keeping your Mac awake. These steps use a DigitalOcean Droplet, but any Ubuntu 24.04 machine works. The server is reachable only over your private Tailscale network. Requests are checked the same way as in [Use Thunk from your phone](remote.md).

Pushing to the branch the server follows (normally `main` of the repo it was cloned from) is enough to deploy: the server picks up new commits within about five minutes and switches to them once nothing is running. For everything else there is one command, `thunk`, which runs on the server.

Replace these placeholders with your own values throughout:

| Placeholder | What it is | Example |
|---|---|---|
| `<user>` | Your user on the server | `alex` |
| `<host>` | The server's Tailscale machine name | `thunk` |
| `<tailnet>` | Your tailnet's DNS name, shown in the Tailscale admin console under **DNS** | `tail1234.ts.net` |
| `<repo>` | The GitHub repo the server deploys from: upstream, or your fork | `Dgiordano33/thunk` |

The server's address is `https://<host>.<tailnet>`. `scripts/server/setup.sh` works out the user, address and Tailscale login on its own, so only the commands below need the placeholders.

## Deploying

A timer on the server checks GitHub every five minutes. When the checkout's branch (normally `main`) has new commits, it builds them beside the running version straight away. It restarts onto the new build only when no agent is working, no routine is running and no workspace is being set up or archived. Agents waiting for your answer, open terminals and Run previews do not hold it back; terminals and previews have to be reopened after the restart.

- `thunk status` shows what the server is doing (`Activity`) and whether automatic updates are on.
- `thunk auto` lists recent automatic updates, including "waiting to restart: 1 agent working".
- `thunk update` deploys right away without waiting.
- `thunk auto off` and `thunk auto on` turn automatic updates off and on.
- After `thunk rollback`, automatic updates pause until you run `thunk update main`. A commit whose build fails is not retried until the next commit lands.
- If `package-lock.json` changed, the whole update waits for an idle moment, because reinstalling dependencies stops Thunk for a few minutes.

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

Projects, workspaces, sessions, tasks and routines are kept in an embedded database in `~/.thunk/db`, beside the memory, notes and vault files, so they survive restarts and updates with no setup. Back up `~/.thunk` to keep everything; the Droplet's weekly backups already include it.

To use your own Postgres instead, such as Supabase, add `DATABASE_URL` with `thunk env`. For Supabase, copy the **Session pooler** string from **Connect** in the dashboard; Supabase's direct connection is IPv6-only unless you add its IPv4 add-on. Do not point the server and the Mac at the same database while both are running: both would run the scheduler and delivery polling.

**Upgrading a server that used `SUPABASE_URL`.** Add `DATABASE_URL` with `thunk env` *before* deploying a version that needs it; older versions ignore it. A new version that finds only `SUPABASE_URL` keeps Thunk running but refuses to use any database, and `thunk doctor` shows `Data: NOT CONNECTED`. Remove the `SUPABASE_*` lines once `thunk doctor` shows `Database: ok`.

## Browser tools

Agents in every project can open pages, click through them and take screenshots. `setup.sh` installs Chromium and writes `~/.thunk/config/mcp.json`, which holds connectors shared by all projects, in the same format as a project's **Connectors** setting. A project connector with the same name replaces the shared one. Changes apply to new sessions.

To add browser tools to a server set up before this existed, run `scripts/server/setup.sh` again from `~/thunk-server`. To change the pinned version, edit the file and run `npx -y @playwright/mcp@<version> install-browser chromium` so the matching Chromium is installed.

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
