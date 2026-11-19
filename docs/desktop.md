# Thunk for macOS

Build a local, ad-hoc signed `Thunk.app` without an Apple Developer account:

```sh
npm ci
npm run desktop:pack
open dist-desktop/mac-arm64/Thunk.app
```

Use macOS and an official Node.js 22.16+ or 24+ installation (for example, via nvm). The build bundles that exact Node executable and targets the Mac's current architecture: `mac-arm64` on Apple Silicon, `mac` on Intel. It rejects Node installations that depend on external libraries, such as Homebrew's Node. Build separately on each architecture; cross-compilation is not supported. Internet access is needed for dependencies, Electron, and the existing Google Fonts build step.

You can copy the generated app to `/Applications` and launch it from Finder. The app contains Electron, Thunk's production Next.js server, Node, the Claude SDK native runtime, and node-pty. No terminal or separately running server is needed. Git, GitHub CLI, Codex CLI, and project-specific tools remain installed on your Mac. The app reads your login shell's PATH to find them and uses your existing CLI logins.

`npm run desktop:dev` prepares the same production backend and opens it in an unpackaged Electron window. `npm run test:desktop` tests startup, shutdown, configuration loading, startup failures, and external-link filtering. Packaging also runs a real PTY check using the copied Node executable. For an isolated smoke test of the finished bundle, run `node scripts/smoke-desktop.mjs dist-desktop/mac-arm64/Thunk.app/Contents/Resources/backend` (use `mac` on Intel). This checks UI assets, API access and origin protection, the bundled PTY and Claude executables, shutdown, and package isolation without using your data or credentials.

## Updating

Choose **Thunk → Check for Updates…**. A small dialog with a rotating hourglass shows the current step while Thunk fetches the latest `main` from `Dgiordano33/thunk`, builds it in a temporary directory, and verifies the resulting bundle. This can take several minutes; the menu and Dock also show that a build is running. Close the progress dialog to keep using the app during the build. Choose **Restart and Update** when ready, or **Later** to discard the prepared update. Restart stops active agents and routines.

The update replaces the app at its existing location, including an Applications copy. Your source checkout, desktop `.env`, and data are untouched. A failed build leaves the current app running. A failed replacement restores the previous app. The previous bundle is retained in a hidden `.thunk-previous-*` folder beside the app; `~/Library/Application Support/Thunk/previous-app.txt` records its path for recovery. You can remove those backup folders once satisfied with an update.

This is a local source updater: you still need Git, npm, an official Node installation, network access, and Git access to the repository. Updates follow `main`, not the branch you originally built. No paid Apple account is needed. **Show Update Log** reveals build errors. Quitting during a build cancels it. If the installation folder is not writable, move Thunk to a folder you own before updating.

For an older app without this menu, build and install this version once using the commands above. Thereafter, use the menu. Updates are checked only when you request them; no background downloads or automatic restarts occur.

## Configuration and data

The **Thunk → Show Configuration** menu reveals `~/Library/Application Support/Thunk/.env`. Add any needed settings, then quit and reopen Thunk:

```dotenv
# Optional; omit to use your Claude login
ANTHROPIC_API_KEY=
# Optional; use the same values as your web installation for persisted sessions
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Optional absolute path if Codex is not on your login shell PATH
CODEX_BIN=/absolute/path/to/codex
# Optional; defaults to the existing ~/.thunk directory
THUNK_DATA_DIR=/absolute/path/to/thunk-data
# Optional remote access over Tailscale; see docs/remote.md
THUNK_PORT=4600
THUNK_TRUSTED_HOSTS=your-mac.tail1234.ts.net
THUNK_TRUSTED_USER=you@example.com
```

Checkout `.env*` files and credentials are not copied into the app. Copy the settings you need into the external config yourself. As with any Next.js build, `NEXT_PUBLIC_*` values are public and embedded at build time. Configuration is shared across local builds and lives outside the app. Project files keep using `~/.thunk` (or `THUNK_DATA_DIR`); rebuilding or replacing the app does not erase them. Without Supabase, existing in-memory session/routine limitations still apply.

Avoid running web and desktop instances against the same data at the same time: they would both run background schedulers and delivery polling. The desktop enforces one desktop instance, but cannot lock out a separately launched web server.

## Use a Thunk server instead

If Thunk runs on a server ([Run Thunk on a server](server.md)), the app can open it instead of starting its own backend. Add one line with **Thunk → Show Configuration**, then quit and reopen Thunk:

```dotenv
THUNK_REMOTE_URL=https://thunk.tail1234.ts.net
```

With `THUNK_REMOTE_URL` set, the app starts nothing on your Mac and ignores the other settings in the file. Agents, terminals and data all live on the server. Requests go through Tailscale Serve and are checked as described in [remote access](remote.md), so Tailscale must be connected on the Mac. When the server cannot be reached, the window shows a retry page and tries again every 15 seconds. Quitting the app does not stop anything on the server, and **Show Server Log** is hidden; use `thunk logs` on the server instead.

Remove the line to go back to a local backend. Do not point the local backend at the server's Supabase project while the server is running.

## Window and server lifecycle

The backend binds only to `127.0.0.1`, on `THUNK_PORT` if set and otherwise on an available port. It keeps Thunk's Host/Origin protections on every page and API route; [remote access](remote.md) extends them to your Tailscale name. Electron uses a sandboxed renderer with no Node integration or preload bridge. External HTTP, HTTPS, and mail links open in the system browser; other external protocols are blocked.

Closing the window keeps the app, agents, and routines running, as expected on macOS. Click its Dock icon to reopen. **Quit Thunk / ⌘Q** sends SIGTERM to the backend so existing agent and PTY shutdown hooks run, then forces termination after five seconds if needed. Quit stops active work. Startup/server failures display an error; **Show Server Log** reveals `~/Library/Logs/Thunk/server.log` (replaced on each launch).

## Distribution limits

This is a local macOS build with an ad-hoc signature, not a Developer ID signed or notarized release. Downloaded copies may require manual approval in macOS Privacy & Security. There is no prebuilt-release updater, DMG installer, or Windows/Linux target yet. See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing) for public distribution requirements.
