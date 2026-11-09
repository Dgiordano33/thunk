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
```

Checkout `.env*` files and credentials are not copied into the app. Copy the settings you need into the external config yourself. As with any Next.js build, `NEXT_PUBLIC_*` values are public and embedded at build time. Configuration is shared across local builds and lives outside the app. Project files keep using `~/.thunk` (or `THUNK_DATA_DIR`); rebuilding or replacing the app does not erase them. Without Supabase, existing in-memory session/routine limitations still apply.

Avoid running web and desktop instances against the same data at the same time: they would both run background schedulers and delivery polling. The desktop enforces one desktop instance, but cannot lock out a separately launched web server.

## Window and server lifecycle

The backend binds only to `127.0.0.1` on an available port and retains Thunk's existing Host/Origin API protections. Electron uses a sandboxed renderer with no Node integration or preload bridge. External HTTP, HTTPS, and mail links open in the system browser; other external protocols are blocked.

Closing the window keeps the app, agents, and routines running, as expected on macOS. Click its Dock icon to reopen. **Quit Thunk / ⌘Q** sends SIGTERM to the backend so existing agent and PTY shutdown hooks run, then forces termination after five seconds if needed. Quit stops active work. Startup/server failures display an error; **Show Server Log** reveals `~/Library/Logs/Thunk/server.log` (replaced on each launch).

## Distribution limits

This is a local macOS build with an ad-hoc signature, not a Developer ID signed or notarized release. Downloaded copies may require manual approval in macOS Privacy & Security. There is no updater, DMG installer, Windows/Linux target, or custom app artwork yet. See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing) for public distribution requirements.
