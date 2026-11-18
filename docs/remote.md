# Use Thunk from your phone

Thunk runs on your Mac. To use it from an iPhone, iPad or another computer, put the devices on a private [Tailscale](https://tailscale.com) network and let Tailscale Serve forward an HTTPS address to Thunk. Thunk still listens on `127.0.0.1` only, and nothing is exposed to the public internet.

Thunk is not deployed to Vercel or any other host. It spawns agents, terminals and git commands on the machine it runs on and uses that machine's CLI logins, so remote access works only while the Mac is awake and Thunk is running. To run Thunk on an always-on server instead, see [Run Thunk on a server](server.md).

Setup takes about 10 minutes.

## 1. Set up Tailscale

1. Create a free account at [tailscale.com](https://tailscale.com). Any sign-in works, for example GitHub.
2. Install Tailscale on the Mac ([download](https://tailscale.com/download/mac)) and on the phone (App Store or Play Store). Sign in to the same account on both.
3. In the admin console, open [Machines](https://login.tailscale.com/admin/machines) and check that both devices show **Connected**.
4. Open [DNS](https://login.tailscale.com/admin/dns). Turn on **MagicDNS**, then click **Enable HTTPS** under **HTTPS Certificates**. Serve cannot issue a certificate without HTTPS Certificates.

## 2. Find your Mac's name and login

The Mac app does not put `tailscale` on your `PATH`. Use its full path:

```sh
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
$TS status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
$TS whois --json "$($TS ip -4)" | python3 -c 'import json,sys; print(json.load(sys.stdin)["UserProfile"]["LoginName"])'
```

The first command prints the Mac's name, such as `your-mac.tail1234.ts.net`. The second prints your Tailscale login. A GitHub sign-in looks like `YourName@github`, not an email address. You can also find both values in the admin console: the name is under **Machines**, and the login is shown under each machine.

## 3. Configure Thunk

Add three settings. Use your values from step 2.

```dotenv
# Tailnet names allowed besides localhost (comma-separated)
THUNK_TRUSTED_HOSTS=your-mac.tail1234.ts.net
# Your Tailscale login; other tailnet users and shared devices are refused
THUNK_TRUSTED_USER=YourName@github
# A fixed port for Serve to target
THUNK_PORT=4600
```

Where the settings go depends on how you run Thunk:

- **Desktop app** ([docs/desktop.md](desktop.md)): choose **Thunk → Show Configuration** in the macOS menu bar, not the in-app Settings panel. This opens `~/Library/Application Support/Thunk/.env`; you can also open it directly with `open -e ~/Library/Application\ Support/Thunk/.env`. Add the lines, then quit Thunk with ⌘Q and reopen it. Thunk reads the file when it starts, so a rebuild is not needed.
- **From source** (`npm run dev` or `npm start`): put `THUNK_TRUSTED_HOSTS` and `THUNK_TRUSTED_USER` in `.env.local`, and pin the port on the command line, for example `PORT=4600 npm start`. `THUNK_PORT` applies only to the desktop app.

Remote access needs both `THUNK_TRUSTED_HOSTS` and `THUNK_TRUSTED_USER`. If either is missing, Thunk stays local-only.

## 4. Start Serve

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4600
```

Serve keeps running in the background and survives reboots. `tailscale serve status` shows the current setup, and `tailscale serve --https=443 off` stops it.

## 5. Open it on your phone

Open `https://your-mac.tail1234.ts.net` in the phone's browser. On iPhone, tap **Share → Add to Home Screen** to get an app-style icon.

To check the setup from the Mac:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://your-mac.tail1234.ts.net/api/models   # expect 200
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Page does not load, or the connection times out | Tailscale is off on the phone or the Mac, the Mac is asleep, or Thunk is not running. `lsof -iTCP:4600 -sTCP:LISTEN` shows whether Thunk is listening. |
| Certificate error, or Serve refuses to start | HTTPS Certificates is off in the admin console (step 1.4). |
| `Forbidden` (403) | The server log says why. For the desktop app, use **Thunk → Show Server Log**, or open `~/Library/Logs/Thunk/server.log`. Look for `[access] denied`. A message of `host not allowed` means the name in `THUNK_TRUSTED_HOSTS` does not match. `Tailscale user not allowed` means `THUNK_TRUSTED_USER` does not match your login. |
| Settings seem to have no effect | Thunk was not restarted after editing the config. Quit with ⌘Q and reopen. |
| 502 from Serve | Thunk is not listening on the port Serve targets. Check `THUNK_PORT` and the port in the `serve` command. |

## How requests are checked

`proxy.ts` checks every page and API request (`lib/access.ts`):

- `Host` must be loopback or a `THUNK_TRUSTED_HOSTS` name. This blocks LAN access and DNS rebinding.
- `Origin`, when present, must be loopback or a trusted name. This blocks cross-site requests.
- A request on a trusted name must carry the `Tailscale-User-Login` header that Serve adds, and its value must equal `THUNK_TRUSTED_USER`. Serve replaces any copy of the header sent by the client. The header can be trusted only because Thunk listens on loopback, so do not bind Thunk to `0.0.0.0` or another interface.

Do not use **Tailscale Funnel** for Thunk. Funnel publishes the address to the internet. Funnel requests carry no Tailscale identity, so Thunk refuses them, but the address is still public.

## Limits

- **Previews:** **Run** previews open `http://127.0.0.1:<port>` and do not load from the phone.
- **Folders:** from the phone, **Add project** and **Add repo** show an in-page browser of folders under your home folder on the Mac (`GET /api/fs/list`), or take a typed path. The macOS dialog is used only when the browser runs on the Mac itself. **Reveal in Finder** is hidden on remote clients.
- **Agents:** anyone with your Tailscale login and an unlocked device can direct agents on your Mac with your permission modes.
