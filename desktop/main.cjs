const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require("electron");
const { mkdirSync, openSync, closeSync, existsSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const { startBackend, configuredRemote, loginPath, toolPath, externalUrl } = require("./runtime.cjs");
const { gitVersion, gitHelp } = require("./prerequisites.cjs");

const { connections, readKey } = require("./connections.cjs");
const { syncSetup, describeSummary } = require("./setup-sync.cjs");
const { releaseUrl } = require("./releases.cjs");
const { parseEnv } = require("node:util");

const { prepareUpdate, installUpdate, configuredUpdateSource } = require("./updater.cjs");

app.setName("Thunk");
const isMac = process.platform === "darwin";

/** Which download to pick from a release page for this computer (see scripts/archive-desktop.mjs). */
function releaseAsset() {
  if (isMac) return `the ${process.arch === "arm64" ? "Apple Silicon" : "Intel"} ZIP`;
  if (process.platform === "win32") return `the Windows ${process.arch === "arm64" ? "ARM64" : "x64"} ZIP`;
  return `the Linux ${process.arch === "arm64" ? "ARM64" : "x64"} archive`;
}

/** Git is not bundled on macOS or Linux; say how to get it rather than failing later in a project. */
async function checkGit(env) {
  if (await gitVersion(env)) return;
  const help = gitHelp();
  const { response } = await dialog.showMessageBox({
    type: "warning", message: "Git is not installed", detail: help.detail,
    buttons: [help.action.label, "Later"], defaultId: 0, cancelId: 1,
  });
  if (response !== 0) return;
  if (help.action.url) await shell.openExternal(help.action.url);
  else require("node:child_process").execFile(...help.action.command, (error) => { if (error) console.error("Could not start the Git installer:", error); });
}
let backend;
let window;
let quitting = false;
let stopped = false;
let starting = true;
let updateController;
let updateTask;
let setupSync;

/** Send this Mac's Claude Code and Codex setup to the Thunk server the window shows. One sync at a time. */
function syncSetupToServer() {
  setupSync ??= syncSetup({
    baseUrl: backend.url,
    onProgress: (text) => { if (window && !window.isDestroyed()) window.webContents.send("thunk:sync-progress", text); },
  }).finally(() => { setupSync = null; });
  return setupSync;
}

async function checkForUpdates(item) {
  if (updateController) return;
  updateController = new AbortController();
  item.enabled = false;
  item.label = "Building Update…";
  window?.setProgressBar(2);
  const logFile = path.join(app.getPath("logs"), "update.log");
  let prepared;
  let progressWindow;
  const closeProgress = () => {
    if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
  };
  try {
    progressWindow = new BrowserWindow({
      parent: window || undefined, modal: true, title: "Updating Thunk",
      width: 420, height: 390, resizable: false, minimizable: false, maximizable: false,
      show: false, titleBarStyle: "hiddenInset", backgroundColor: "#f7f3e9",
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await progressWindow.loadFile(path.join(__dirname, "update.html"));
    if (quitting) return;
    if (!progressWindow.isDestroyed()) progressWindow.show();
    const onProgress = (message) => {
      if (!progressWindow.isDestroyed()) {
        void progressWindow.webContents.executeJavaScript(`document.getElementById("status").textContent = ${JSON.stringify(message)}`).catch(console.error);
      }
    };
    const root = path.join(process.resourcesPath, "backend");
    const { revision } = JSON.parse(readFileSync(path.join(root, "version.json"), "utf8"));
    const target = path.resolve(process.execPath, "../../..");
    // Only pass build essentials, not runtime database or agent credentials.
    const env = { HOME: app.getPath("home"), PATH: loginPath(), SHELL: process.env.SHELL || "/bin/zsh", TMPDIR: process.env.TMPDIR, LANG: process.env.LANG };
    const source = configuredUpdateSource(path.join(app.getPath("userData"), ".env"));
    prepared = await prepareUpdate({ target, revision, env, logFile, source, signal: updateController.signal, onProgress });
    closeProgress();
    if (quitting) return;
    window?.setProgressBar(-1);
    if (!prepared) {
      await dialog.showMessageBox({ message: "Thunk is up to date", detail: `You are running the latest commit on ${source.branch}.` });
      return;
    }
    const { response } = await dialog.showMessageBox({
      message: "Your update is ready",
      detail: "Restarting stops active agents and routines. Your configuration and data will stay in place. A backup of this app will be kept beside it.",
      buttons: ["Restart and Update", "Later"], defaultId: 1, cancelId: 1,
    });
    if (response !== 0 || quitting) return;
    quitting = true;
    await backend.stop();
    stopped = true;
    try {
      const backup = installUpdate(prepared.staged, target);
      try { writeFileSync(path.join(app.getPath("userData"), "previous-app.txt"), backup + "\n"); } catch (error) { console.error("Could not record backup location:", backup, error); }
    } catch (error) {
      dialog.showErrorBox("Update could not be installed", `${error.message}\nThe previous app will reopen.`);
    }
    app.relaunch();
    app.quit();
  } catch (error) {
    closeProgress();
    if (!quitting) dialog.showErrorBox("Update could not be built", `${error.message}\nYour current app has not been replaced.\n\nSee ${logFile}`);
  } finally {
    closeProgress();
    if (prepared) rmSync(prepared.staging, { recursive: true, force: true });
    updateController = null;
    item.enabled = true;
    item.label = "Build Update from Source…";
    window?.setProgressBar(-1);
  }
}

async function openWindow() {
  window = new BrowserWindow({
    title: "Thunk", width: 1440, height: 960, minWidth: 900, minHeight: 600,
    show: false,
    // macOS and Windows take the icon from the app bundle; Linux window managers need it here.
    ...(process.platform === "linux" ? { icon: path.join(__dirname, "icon.png") } : {}),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      ...(backend.remote ? { preload: path.join(__dirname, "app-preload.cjs") } : {}),
    },
  });
  const openExternal = (url) => {
    if (externalUrl(url)) void shell.openExternal(url).catch(console.error);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== backend.url) {
      event.preventDefault();
      openExternal(url);
    }
  });
  // A remote server can be unreachable (Tailscale off, server restarting); show a retry page instead of failing.
  window.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (!backend.remote || !isMainFrame || code === -3 || !validatedURL.startsWith(backend.url)) return;
    void window?.loadFile(path.join(__dirname, "offline.html"), { query: { url: backend.url, error: description } }).catch(console.error);
  });
  window.on("closed", () => { window = null; });
  await window.loadURL(backend.url).catch((error) => { if (!backend.remote) throw error; });
  window.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) { window.restore(); window.show(); window.focus(); }
  });
  app.on("before-quit", (event) => {
    quitting = true;
    if (stopped) return;
    if (updateController) {
      event.preventDefault();
      updateController.abort();
      void updateTask.finally(() => app.quit());
      return;
    }
    if (starting) { event.preventDefault(); return; }
    if (!backend) return;
    event.preventDefault();
    void backend.stop().finally(() => { stopped = true; app.quit(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => {
    if (backend && !window && !quitting) void openWindow().catch(fail);
  });
  const fail = (error) => {
    starting = false;
    dialog.showErrorBox("Thunk could not run", `${error.message}\n\nSee ${path.join(app.getPath("logs"), "server.log")}`);
    app.quit();
  };
  app.whenReady().then(async () => {
    const userData = app.getPath("userData");
    mkdirSync(userData, { recursive: true });
    app.setAppLogsPath();
    mkdirSync(app.getPath("logs"), { recursive: true });
    const config = path.join(userData, ".env");
    if (!existsSync(config)) writeFileSync(config, "# Optional: ANTHROPIC_API_KEY, DATABASE_URL, CODEX_BIN, THUNK_DATA_DIR, THUNK_PORT, THUNK_TRUSTED_HOSTS, THUNK_TRUSTED_USER, THUNK_REMOTE_URL, THUNK_UPDATE_REPO, THUNK_UPDATE_BRANCH\n", { mode: 0o600, flag: "wx" });
    const remote = configuredRemote(config);
    const root = app.isPackaged ? path.join(process.resourcesPath, "backend") : path.resolve(__dirname, "../build/desktop");
    const configValues = parseEnv(readFileSync(config, "utf8"));
    const credential = remote ? undefined : readKey(path.join(userData, "anthropic-key.enc"));
    const runtimeEnv = { ...process.env, ...configValues, PATH: [toolPath(root), loginPath()].join(path.delimiter), ...(credential ? { ANTHROPIC_API_KEY: credential } : {}) };
    const showConnections = remote ? undefined : connections({ app, env: runtimeEnv, configKey: !!runtimeEnv.ANTHROPIC_API_KEY });
    // macOS has an app menu with Hide/Show; Windows and Linux get the same items under a "Thunk" menu.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { ...(isMac ? { role: "appMenu" } : { label: "Thunk" }), submenu: [
        { role: "about" }, { type: "separator" },
        { label: "Download Latest Release…", click: async () => {
          try {
            const result = await dialog.showMessageBox({ message: "Download a ready-to-use update", detail: `Choose ${releaseAsset()}. Quit Thunk before replacing the app${isMac ? " in Applications" : ""}, then reopen it. Your data and connections stay in place.`, buttons: ["Open Downloads", "Cancel"], cancelId: 1 });
            if (result.response === 0) await shell.openExternal(releaseUrl(config));
          } catch (error) { dialog.showErrorBox("Could not open downloads", error.message); }
        } },
        // The source updater rebuilds and swaps a .app bundle, so it is macOS-only for now.
        ...(isMac ? [{ label: "Build Update from Source…", enabled: app.isPackaged, click: (item) => { updateTask = checkForUpdates(item); } }] : []),
        ...(showConnections ? [{ label: "Connections…", click: () => void showConnections().catch(fail) }] : []),
        ...(remote ? [{ label: "Sync My Setup to Server", click: () => {
          syncSetupToServer().then(
            (summary) => dialog.showMessageBox({ message: "Your setup is on the server", detail: `${describeSummary(summary)}\n\nNew sessions use it; running sessions keep what they started with.` }),
            (error) => dialog.showErrorBox("Could not sync your setup", error.message),
          );
        } }] : []),
        ...(isMac ? [{ label: "Show Update Log", click: () => shell.showItemInFolder(path.join(app.getPath("logs"), "update.log")) }] : []),
        { type: "separator" },
        { label: "Show Configuration", click: () => shell.showItemInFolder(config) },
        ...(remote ? [] : [{ label: "Show Server Log", click: () => shell.showItemInFolder(path.join(app.getPath("logs"), "server.log")) }]),
        ...(isMac ? [{ type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }] : []),
        { type: "separator" }, { role: "quit" },
      ] },
      { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    ]));
    if (remote) {
      // Only the server's own page in the main window may start a sync.
      ipcMain.handle("thunk:sync-setup", (event) => {
        const frame = event.senderFrame;
        if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame || new URL(frame.url).origin !== new URL(backend.url).origin) throw new Error("Not allowed");
        return syncSetupToServer();
      });
      // THUNK_REMOTE_URL: open a Thunk server (docs/server.md) and start nothing locally.
      backend = { url: remote, remote: true, stop: async () => {}, exited: new Promise(() => {}) };
    } else {
      const log = openSync(path.join(app.getPath("logs"), "server.log"), "w", 0o600);
      try {
        backend = await startBackend({ root, config, log, env: runtimeEnv });
      } finally {
        closeSync(log);
      }
      backend.exited.then(() => { if (!quitting) fail(new Error("The local server exited unexpectedly. Restart Thunk.")); });
    }
    starting = false;
    if (quitting) { app.quit(); return; }
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === window?.webContents && new URL(contents.getURL()).origin === backend.url && permission === "notifications");
    });
    await openWindow();
    const onboarding = path.join(userData, "connections-seen");
    if (showConnections && !existsSync(onboarding)) {
      await showConnections();
      writeFileSync(onboarding, "1", { mode: 0o600 });
    }
    if (!remote) void checkGit(runtimeEnv).catch(console.error);
  }).catch(fail);
}
