#!/usr/bin/env bash
# Turns a Linux checkout of Thunk into an always-on service (docs/server.md).
# Run it from the checkout as your normal user. Safe to run again: it only fills in what is missing.
set -euo pipefail

REPO=$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)
ME=$(id -un)
ENV_FILE=/etc/thunk.env
STATE_DIR="$HOME/.config/thunk"
UNIT=/etc/systemd/system/thunk.service
PLAYWRIGHT_MCP=0.0.86   # pinned: each release needs its own Chromium build

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "this script is for the Linux server; on a Mac use the desktop app (docs/desktop.md)"
[ "$ME" != root ] || die "run as your normal user, not root"
for bin in node npm git tailscale python3 curl; do
  command -v "$bin" >/dev/null || die "$bin is not installed (see docs/server.md, 'Build the server')"
done

ts_json() { tailscale status --json; }
TS_NAME=$(ts_json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
TS_LOGIN=$(ts_json | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(d.get("User", {}).get(str(d["Self"].get("UserID")), {}).get("LoginName", ""))')

say "Settings in $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then sudo install -m 600 -o "$ME" -g "$ME" /dev/null "$ENV_FILE"; fi
# Agents run as this user and inherit the environment anyway, so a root-owned file adds nothing.
sudo chown "$ME:$ME" "$ENV_FILE" && chmod 600 "$ENV_FILE"
add_default() {
  if ! grep -q "^$1=" "$ENV_FILE"; then echo "$1=$2" >> "$ENV_FILE"; echo "    added $1=$2"; fi
}
add_default PORT 4600
add_default THUNK_TRUSTED_HOSTS "$TS_NAME"
if [ -n "$TS_LOGIN" ]; then add_default THUNK_TRUSTED_USER "$TS_LOGIN"
elif ! grep -q "^THUNK_TRUSTED_USER=" "$ENV_FILE"; then echo "    warning: set THUNK_TRUSTED_USER to your Tailscale login with 'thunk env'"; fi
grep -qE '^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=.' "$ENV_FILE" \
  || echo "    warning: no CLAUDE_CODE_OAUTH_TOKEN; run 'claude setup-token' and add it with 'thunk env'"
if grep -qE '^SUPABASE_URL=.' "$ENV_FILE" && ! grep -qE '^DATABASE_URL=.' "$ENV_FILE"; then
  echo "    warning: SUPABASE_URL is no longer used; set DATABASE_URL with 'thunk env' (docs/server.md, 'Keep your data')"
fi
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)

say "Build"
mkdir -p "$STATE_DIR"
[ -f "$STATE_DIR/dist.env" ] || echo "THUNK_DIST_DIR=.next-a" > "$STATE_DIR/dist.env"
DIST=$(sed -n 's/^THUNK_DIST_DIR=//p' "$STATE_DIR/dist.env")
cd "$REPO"
[ -d node_modules ] || npm ci --no-audit --no-fund
if [ ! -f "$DIST/BUILD_ID" ]; then
  THUNK_DIST_DIR="$DIST" npm run build
  git rev-parse HEAD > "$DIST/.thunk-sha"
fi

# Writes a root-owned file only when its content changes; returns 0 when it changed.
CHANGED=0
put() {
  if ! sudo cmp -s "$2" "$1" 2>/dev/null; then sudo install -m 644 "$2" "$1"; CHANGED=1; fi
  rm -f "$2"
}
SERVICE_PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

say "systemd services"
TMP=$(mktemp)
cat > "$TMP" <<UNIT_EOF
[Unit]
Description=Thunk
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=$ME
WorkingDirectory=$REPO
EnvironmentFile=$ENV_FILE
EnvironmentFile=-$STATE_DIR/dist.env
Environment=NODE_ENV=production
Environment=PATH=$SERVICE_PATH
ExecStart=$REPO/node_modules/.bin/next start -H 127.0.0.1
Restart=always
RestartSec=3
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
UNIT_EOF
put "$UNIT" "$TMP"
SERVICE_CHANGED=$CHANGED

# Automatic updates: build new commits on the checkout's branch, restart once nothing is running.
TMP=$(mktemp)
cat > "$TMP" <<UNIT_EOF
[Unit]
Description=Deploy new Thunk commits when idle (thunk autoupdate)
After=thunk.service

[Service]
Type=oneshot
User=$ME
WorkingDirectory=$REPO
Environment=PATH=$SERVICE_PATH
ExecStart=/usr/local/bin/thunk autoupdate
TimeoutStartSec=45min
Nice=10
UNIT_EOF
put /etc/systemd/system/thunk-autoupdate.service "$TMP"
TMP=$(mktemp)
cat > "$TMP" <<UNIT_EOF
[Unit]
Description=Check for new Thunk commits every minute

[Timer]
OnBootSec=1min
OnUnitInactiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT_EOF
put /etc/systemd/system/thunk-autoupdate.timer "$TMP"

say "Passwordless control for '$ME'"
SUDOERS=$(mktemp)
cat > "$SUDOERS" <<SUDO_EOF
$ME ALL=(root) NOPASSWD: /usr/bin/systemctl start thunk, /usr/bin/systemctl stop thunk, /usr/bin/systemctl restart thunk, /usr/bin/systemctl enable --now thunk-autoupdate.timer, /usr/bin/systemctl disable --now thunk-autoupdate.timer
SUDO_EOF
sudo visudo -cf "$SUDOERS" >/dev/null && sudo install -m 440 "$SUDOERS" /etc/sudoers.d/thunk
rm -f "$SUDOERS"
sudo usermod -aG systemd-journal "$ME"      # read logs without sudo (applies from the next login)
sudo tailscale set --operator="$ME"         # run 'tailscale serve' without sudo
sudo ln -sf "$REPO/scripts/server/thunk" /usr/local/bin/thunk

# Browser tools for every project's agents (docs/server.md, 'Browser tools'). Left alone once the file exists.
SHARED_MCP="$HOME/.thunk/config/mcp.json"
if [ ! -f "$SHARED_MCP" ]; then
  say "Browser tools for agents"
  npx -y "@playwright/mcp@$PLAYWRIGHT_MCP" install-browser chromium --with-deps
  mkdir -p -m 700 "$(dirname "$SHARED_MCP")"
  cat > "$SHARED_MCP" <<MCP_EOF
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@$PLAYWRIGHT_MCP", "--headless", "--browser", "chromium", "--isolated"]
    }
  }
}
MCP_EOF
  chmod 600 "$SHARED_MCP"
fi

say "Start"
tmux kill-session -t thunk 2>/dev/null && echo "    stopped the old tmux session" || true
sudo systemctl daemon-reload
sudo systemctl enable thunk >/dev/null 2>&1
if [ "$SERVICE_CHANGED" = 1 ] || ! systemctl is-active --quiet thunk; then sudo systemctl restart thunk; fi
sudo systemctl enable --now thunk-autoupdate.timer >/dev/null 2>&1
tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null

# Bring the live build up to this checkout (a no-op when it already is).
"$REPO/scripts/server/thunk" update

say "Done: https://$TS_NAME"
echo "    'thunk' is now a command on this server. Run 'thunk help' to see what it does."
echo "    New commits on $(git rev-parse --abbrev-ref HEAD) deploy automatically when idle; 'thunk auto off' stops that."
echo "    Log out and back in once so 'thunk logs' works without sudo."
