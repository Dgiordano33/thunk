# Thunk desktop app

Thunk packages as a standalone desktop app for macOS, Linux and Windows. Each build bundles Electron, Thunk's production server, Node, the Claude SDK runtime, node-pty, Codex CLI, ripgrep and GitHub CLI for the machine it is built on. There is no cross-compilation: build on each platform and architecture, or let the [release workflow](#publish-all-builds) do it.

| Platform | Build output | Share as | Git |
|---|---|---|---|
| macOS | `dist-desktop/mac-arm64/Thunk.app` (`mac` on Intel) | `Thunk-<version>-Apple-Silicon.zip` / `Intel.zip` | Apple's Command Line Tools |
| Linux | `dist-desktop/linux-unpacked/thunk` (`linux-arm64-unpacked` on ARM) | `Thunk-<version>-Linux-x64.tar.gz` / `Linux-ARM64.tar.gz` | Your package manager |
| Windows | `dist-desktop/win-unpacked/Thunk.exe` | `Thunk-<version>-Windows-x64.zip` | Bundled (MinGit) when built with `THUNK_MINGIT_DIR` |

`npm run desktop:pack` builds the unpacked app for the current machine, and `npm run desktop:release` also smoke-tests and archives it. Thunk checks for Git when it starts; if it is missing, a dialog explains how to install it on that platform (on a Mac it offers to start Apple's Command Line Tools installer). **Thunk → Connections** also shows whether Git is installed.

## macOS

Build a local, ad-hoc signed `Thunk.app` without an Apple Developer account:

```sh
npm ci
npm run desktop:pack
open dist-desktop/mac-arm64/Thunk.app
```

Install GitHub CLI (`brew install gh`) on the build machine first. Packaging copies its standalone executable and rejects external library dependencies. Use macOS and an official Node.js 22.16+ or 24+ installation (for example, via nvm). The build bundles that exact Node executable and targets the Mac's current architecture: `mac-arm64` on Apple Silicon, `mac` on Intel. It rejects Node installations that depend on external libraries, such as Homebrew's Node. Build separately on each architecture; cross-compilation is not supported. Internet access is needed for dependencies, Electron, and the existing Google Fonts build step.

You can copy the generated app to `/Applications` and launch it from Finder. The app contains Electron, Thunk's production Next.js server, Node, the Claude SDK native runtime, and node-pty. No terminal or separately running server is needed. Codex CLI, ripgrep, and GitHub CLI are bundled too. Git and project-specific tools still need to be installed on your Mac. A clean Mac may prompt you to install Apple’s Command Line Tools for Git. The app reads your login shell's PATH to find them and uses your existing CLI logins.

`npm run desktop:dev` prepares the same production backend and opens it in an unpackaged Electron window. `npm run test:desktop` tests startup, shutdown, configuration loading, startup failures, and external-link filtering. Packaging also runs a real PTY check using the copied Node executable. For an isolated smoke test of the finished bundle, run `node scripts/smoke-desktop.mjs dist-desktop/mac-arm64/Thunk.app/Contents/Resources/backend` (use `mac` on Intel). This checks UI assets, API access and origin protection, the bundled PTY and Claude executables, shutdown, and package isolation without using your data or credentials.

## Linux

```sh
npm ci
npm run desktop:pack
dist-desktop/linux-unpacked/thunk
```

Build with an official Node.js 22.16+ or 24+ (nodejs.org or nvm), not a distro package: the build bundles that Node executable and rejects one that links libraries outside glibc. Install GitHub CLI (`gh`) and a C++ toolchain first; node-pty compiles from source on Linux. Run the app from any folder you own.

Linux specifics:

- **Sandbox.** Electron needs either unprivileged user namespaces or a setuid `chrome-sandbox`. On distributions that restrict namespaces (Ubuntu 24.04 and later), run once from the app folder: `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.
- **Folder dialog.** Choosing a folder uses `zenity` (GNOME) or `kdialog` (KDE). Without either, Thunk shows its in-page folder browser instead.
- **Reveal in file manager** uses the desktop's FileManager1 service, falling back to `xdg-open`.
- **API key storage** uses your keyring (GNOME Keyring or KWallet) through Electron safeStorage. Without one, saving a key in Connections fails; set `ANTHROPIC_API_KEY` in **Thunk → Show Configuration** instead.
- **PATH.** Like on macOS, Thunk reads your login shell's PATH so nvm, asdf and other tools are found when launched from an app menu.

## Windows

```powershell
npm ci
npm run desktop:pack
dist-desktop\win-unpacked\Thunk.exe
```

Install GitHub CLI first. To bundle Git, unzip a `MinGit-*-64-bit.zip` from the [Git for Windows releases](https://github.com/git-for-windows/git/releases) and set `THUNK_MINGIT_DIR` to that folder before packaging; the release workflow does this. Without it, recipients install Git for Windows themselves (`winget install --id Git.Git -e`).

Windows specifics:

- **Shells.** `thunk.json` scripts and chart source commands run through `cmd.exe` (as `npm run` does), and the workspace terminal opens PowerShell. Set `SHELL` to a POSIX shell such as Git Bash's `bash.exe` in **Thunk → Show Configuration** to use it for both instead.
- **The build is unsigned**, so SmartScreen may ask for confirmation on first launch.
- **Build Update from Source** is macOS-only; on Windows and Linux, download a new release and replace the folder.

Windows support is new and has had less real-world use than macOS and Linux; please report problems.

## Connections

On first launch, a Connections window opens. Reopen it with **Thunk → Connections…**. It is available for local desktop mode only; remote server credentials must be configured on the server.

- **Codex:** click Connect ChatGPT, then Open sign-in page and enter the displayed device code. Device sign-in must be enabled for your account. Existing Codex CLI authentication is recognized; this uses the same credentials as the CLI.
- **Claude:** paste an Anthropic API key and Save connection. Thunk validates it without starting an agent turn and encrypts it with Electron safeStorage (macOS Keychain, Windows DPAPI, or the Linux keyring). API usage is billed separately from Claude subscriptions. Quit and reopen Thunk after saving or removing the key; finish active work first. A saved key overrides `ANTHROPIC_API_KEY` in the desktop configuration. Removing it falls back to any key or authentication already configured outside Connections. The UI never displays a stored key. Existing local Claude authentication continues to work as before; Connections does not provide Claude subscription login.
- **GitHub:** click Connect GitHub, then complete browser authorization with the displayed code. GitHub CLI stores credentials using its supported credential store. Existing CLI authentication is shared. This does not install Git or configure SSH keys.

Closing Connections cancels a pending login. You can skip setup and return later. For Codex/GitHub account removal, use their CLI logout commands; the UI deliberately does not silently sign other apps out of shared accounts.

## Share a prebuilt app

```sh
npm ci
npm run desktop:release
```

This runs the production build, packages and smoke-tests the app, verifies its ad-hoc signature, and creates `dist-desktop/Thunk-<version>-Apple-Silicon.zip` (or `Intel.zip`) plus a SHA-256 checksum. The version comes from `desktop/package.json`. Your regular `npm run desktop:pack` still produces the unpacked app at the same path. Bundled tools make the download larger.

Send the ZIP for the recipient’s processor. They unzip it, move Thunk to Applications, open it (approving it in Privacy & Security if needed), and connect an agent. They do not need Node, npm, a source checkout, or access to the source repository. Git and any tools needed by their projects are separate prerequisites.

**Thunk → Download Latest Release…** opens the published GitHub release page and tells the user which ZIP to select. Quit Thunk, replace the app, and reopen. Data in `~/.thunk`, desktop configuration, encrypted keys, and CLI logins stay in place. This is a manual download flow, not an automatic version check or installation. Until a release is published, the link may show GitHub’s not-found page.

Set `THUNK_RELEASE_REPO=owner/downloads` in the desktop configuration to use a different release repository. This is independent of `THUNK_UPDATE_REPO`, which controls builds from source. GitHub requires repository access for downloads from a private repository; use a public download repository to share with people who cannot access your source.

## Publish all builds

The workflow `.github/workflows/desktop-release.yml` builds on native runners (macOS Apple Silicon and Intel, Linux x64 and ARM64, Windows x64), smoke-tests each bundle, and creates a **draft** release with every archive and checksum. The Windows job downloads MinGit from the latest Git for Windows release and bundles it. It does not publish automatically.

1. Merge the changes you want to distribute into your release branch (normally `main`).
2. Set a fresh version in `desktop/package.json`, such as `0.1.1`, and commit it.
3. Tag that commit and push the tag: `git tag v0.1.1` then `git push origin v0.1.1`. The tag must match the desktop version exactly.
4. Wait for the **Desktop release** workflow to pass for every platform.
5. Open GitHub Releases, review the draft and publish it. Share the release link.

GitHub Actions must be enabled, with permission to create releases. Builds need internet access and available macOS runner minutes. The workflow uses GitHub CLI preinstalled on those runners. No Apple signing secrets are required for this ad-hoc distribution path.

For private source with public downloads, download both artifacts from the draft and upload them to a release in your public downloads repository. Configure `THUNK_RELEASE_REPO` for recipients. Automatic cross-repository publication is not configured.

For a future automatic installer, use Developer ID signing and a standard updater such as electron-updater; the current manual path avoids introducing a custom unsigned remote-code installer.

## Updating from source

Choose **Thunk → Build Update from Source…**. A small dialog with a rotating hourglass shows the current step while Thunk fetches the latest `main` from `Dgiordano33/thunk` (or [your fork](#update-from-a-fork)), builds it in a temporary directory, and verifies the resulting bundle. This can take several minutes; the menu and Dock also show that a build is running. Close the progress dialog to keep using the app during the build. Choose **Restart and Update** when ready, or **Later** to discard the prepared update. Restart stops active agents and routines.

The update replaces the app at its existing location, including an Applications copy. Your source checkout, desktop `.env`, and data are untouched. A failed build leaves the current app running. A failed replacement restores the previous app. The previous bundle is retained in a hidden `.thunk-previous-*` folder beside the app; `~/Library/Application Support/Thunk/previous-app.txt` records its path for recovery. You can remove those backup folders once satisfied with an update.

This is a local source updater: you still need Git, npm, an official Node installation, network access, and Git access to the repository. Updates follow `main` (or `THUNK_UPDATE_BRANCH`), not the branch you originally built. No paid Apple account is needed. **Show Update Log** reveals build errors. Quitting during a build cancels it. If the installation folder is not writable, move Thunk to a folder you own before updating.

For an older app without this menu, build and install this version once using the commands above. Thereafter, use the menu. Updates are checked only when you request them; no background downloads or automatic restarts occur.

### Update from a fork

By default, updates come from the upstream repo. If you forked Thunk, add these lines with **Thunk → Show Configuration** so updates build your fork instead. Without them, an update replaces your changes with upstream `main`:

```dotenv
# GitHub owner/repo, any git URL, or an absolute path to a local clone
THUNK_UPDATE_REPO=you/thunk
# Optional; defaults to main
THUNK_UPDATE_BRANCH=main
```

The settings are read each time you choose **Build Update from Source…**, so no restart is needed.

## Configuration and data

The **Thunk → Show Configuration** menu reveals `~/Library/Application Support/Thunk/.env`. Add any needed settings, then quit and reopen Thunk:

```dotenv
# Optional; omit to use your Claude login
ANTHROPIC_API_KEY=
# Optional; any Postgres. Without it, data lives in an embedded database in ~/.thunk/db
DATABASE_URL=
# Optional absolute path if Codex is not on your login shell PATH
CODEX_BIN=/absolute/path/to/codex
# Optional; defaults to the existing ~/.thunk directory
THUNK_DATA_DIR=/absolute/path/to/thunk-data
# Optional remote access over Tailscale; see docs/remote.md
THUNK_PORT=4600
THUNK_TRUSTED_HOSTS=your-mac.tail1234.ts.net
THUNK_TRUSTED_USER=you@example.com
# Optional; build updates from a fork (see "Update from a fork")
THUNK_UPDATE_REPO=you/thunk
THUNK_UPDATE_BRANCH=main
```

Checkout `.env*` files and credentials are not copied into the app. Copy the settings you need into the external config yourself. As with any Next.js build, `NEXT_PUBLIC_*` values are public and embedded at build time. Configuration is shared across local builds and lives outside the app. Project files keep using `~/.thunk` (or `THUNK_DATA_DIR`); rebuilding or replacing the app does not erase them. Projects, sessions and routines persist in the embedded database in `~/.thunk/db` unless `DATABASE_URL` is set.

Avoid running web and desktop instances against the same data at the same time: they would both run background schedulers and delivery polling. The desktop enforces one desktop instance, but cannot lock out a separately launched web server.

## Use a Thunk server instead

If Thunk runs on a server ([Run Thunk on a server](server.md)), the app can open it instead of starting its own backend. Add one line with **Thunk → Show Configuration**, then quit and reopen Thunk:

```dotenv
THUNK_REMOTE_URL=https://thunk.tail1234.ts.net
```

With `THUNK_REMOTE_URL` set, the app starts nothing on your Mac and ignores the other settings in the file. Agents, terminals and data all live on the server. Requests go through Tailscale Serve and are checked as described in [remote access](remote.md), so Tailscale must be connected on the Mac. When the server cannot be reached, the window shows a retry page and tries again every 15 seconds. Quitting the app does not stop anything on the server, and **Show Server Log** is hidden; use `thunk logs` on the server instead.

Remove the line to go back to a local backend. Do not point the local backend at the server's database while the server is running.

## Window and server lifecycle

The backend binds only to `127.0.0.1`, on `THUNK_PORT` if set and otherwise on an available port. It keeps Thunk's Host/Origin protections on every page and API route; [remote access](remote.md) extends them to your Tailscale name. Electron uses a sandboxed renderer with no Node integration or preload bridge. External HTTP, HTTPS, and mail links open in the system browser; other external protocols are blocked.

Closing the window keeps the app, agents, and routines running, as expected on macOS. Click its Dock icon to reopen. **Quit Thunk / ⌘Q** sends SIGTERM to the backend so existing agent and PTY shutdown hooks run, then forces termination after five seconds if needed. Quit stops active work. Startup/server failures display an error; **Show Server Log** reveals `~/Library/Logs/Thunk/server.log` (replaced on each launch).

## Distribution limits

This is a local macOS build with an ad-hoc signature, not a Developer ID signed or notarized release. Downloaded copies may require manual approval in macOS Privacy & Security. Prebuilt ZIP downloads are supported; replacing the app is manual. There is no automatic binary installer, DMG installer, or Windows/Linux target yet. See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing) for public distribution requirements.
