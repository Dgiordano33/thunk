const { app, BrowserWindow, Menu, dialog, shell, session } = require("electron");
const { mkdirSync, openSync, closeSync, existsSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const { startBackend, loginPath, externalUrl } = require("./runtime.cjs");

const { prepareUpdate, installUpdate } = require("./updater.cjs");

app.setName("Thunk");
let backend;
let window;
let quitting = false;
let stopped = false;
let starting = true;
let updateController;
let updateTask;

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
    prepared = await prepareUpdate({ target, revision, env, logFile, signal: updateController.signal, onProgress });
    closeProgress();
    if (quitting) return;
    window?.setProgressBar(-1);
    if (!prepared) {
      await dialog.showMessageBox({ message: "Thunk is up to date", detail: "You are running the latest commit on main." });
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
    item.label = "Check for Updates…";
    window?.setProgressBar(-1);
  }
}

async function openWindow() {
  window = new BrowserWindow({
    title: "Thunk", width: 1440, height: 960, minWidth: 900, minHeight: 600,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
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
  window.on("closed", () => { window = null; });
  await window.loadURL(backend.url);
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
    if (!existsSync(config)) writeFileSync(config, "# Optional: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CODEX_BIN, THUNK_DATA_DIR\n", { mode: 0o600, flag: "wx" });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu", submenu: [
        { role: "about" }, { type: "separator" },
        { label: "Check for Updates…", enabled: app.isPackaged, click: (item) => { updateTask = checkForUpdates(item); } },
        { label: "Show Update Log", click: () => shell.showItemInFolder(path.join(app.getPath("logs"), "update.log")) },
        { type: "separator" },
        { label: "Show Configuration", click: () => shell.showItemInFolder(config) },
        { label: "Show Server Log", click: () => shell.showItemInFolder(path.join(app.getPath("logs"), "server.log")) },
        { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" }, { role: "quit" },
      ] },
      { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    ]));
    const root = app.isPackaged ? path.join(process.resourcesPath, "backend") : path.resolve(__dirname, "../build/desktop");
    const log = openSync(path.join(app.getPath("logs"), "server.log"), "w", 0o600);
    try {
      backend = await startBackend({ root, config, log, env: { ...process.env, PATH: loginPath() } });
    } finally {
      closeSync(log);
    }
    starting = false;
    if (quitting) { app.quit(); return; }
    backend.exited.then(() => { if (!quitting) fail(new Error("The local server exited unexpectedly. Restart Thunk.")); });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === window?.webContents && new URL(contents.getURL()).origin === backend.url && permission === "notifications");
    });
    await openWindow();
  }).catch(fail);
}
