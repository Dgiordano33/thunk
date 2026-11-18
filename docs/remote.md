# Remote access over Tailscale

Use Thunk from your phone or another computer while your Mac runs it. Thunk keeps listening on `127.0.0.1` only. [Tailscale Serve](https://tailscale.com/kb/1312/serve) gives it an HTTPS address on your private tailnet and forwards requests to it. Nothing is exposed to the public internet.

Remote access works only while the Mac is awake and Thunk is running.

## One-time setup

1. Install Tailscale on the Mac and on the phone, and sign in to the same account on both.
2. In the [admin console](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS Certificates**.
3. Find the Mac's tailnet name, for example `your-mac.tail1234.ts.net`:

   ```sh
   tailscale status --json | jq -r .Self.DNSName   # drop the trailing dot
   ```

4. Add these settings. For the desktop app, use **Thunk → Show Configuration**. For `npm run dev` or `npm start`, use `.env.local`.

   ```dotenv
   # Tailnet names allowed besides localhost (comma-separated)
   THUNK_TRUSTED_HOSTS=your-mac.tail1234.ts.net
   # Your Tailscale login; other tailnet users and shared devices are refused
   THUNK_TRUSTED_USER=you@example.com
   # Desktop app only: a fixed port for Serve to target
   THUNK_PORT=4600
   ```

   Remote access needs both `THUNK_TRUSTED_HOSTS` and `THUNK_TRUSTED_USER`. With either one missing, Thunk stays local-only.

5. Restart Thunk. For the web server, pin the port instead: `PORT=4600 npm run dev` or `PORT=4600 npm start`.
6. Start Serve. It persists across reboots:

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:4600
   ```

7. On the phone, open `https://your-mac.tail1234.ts.net`. Add it to the home screen for an app-like shortcut.

`tailscale serve status` shows the current setup. `tailscale serve --https=443 off` stops it.

## How requests are checked

`proxy.ts` checks every page and API request (`lib/access.ts`):

- `Host` must be loopback or a `THUNK_TRUSTED_HOSTS` name. This blocks LAN access and DNS rebinding.
- `Origin`, when present, must be loopback or a trusted name. This blocks cross-site requests.
- A request on a trusted name must carry the `Tailscale-User-Login` header that Serve adds, and its value must equal `THUNK_TRUSTED_USER`. Serve replaces any copy of the header sent by the client. The header can be trusted only because Thunk listens on loopback, so do not bind Thunk to `0.0.0.0` or another interface.

Refused requests get a 403 response, and the server log records a line starting with `[access] denied`, giving the reason, `Host` and `Origin`. Check that line first when the phone is refused.

Do not use **Tailscale Funnel** for Thunk. Funnel publishes the address to the internet. Funnel requests carry no Tailscale identity, so Thunk refuses them, but the address is still public.

## Limits

- **Previews:** **Run** previews open `http://127.0.0.1:<port>` and do not load from the phone yet.
- **Folder picker:** it opens a macOS dialog on the Mac, not on the phone. Add repositories from the Mac or by GitHub URL.
- **Agents:** anyone with your Tailscale login and an unlocked device can direct agents on your Mac with your permission modes.
