const { app, BrowserWindow, Menu, dialog, shell, session } = require("electron");
const { mkdirSync, openSync, closeSync, existsSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { startBackend, loginPath, externalUrl } = require("./runtime.cjs");

app.setName("Thunk");
let backend;
let window;
let quitting = false;
let stopped = false;
let starting = true;

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
