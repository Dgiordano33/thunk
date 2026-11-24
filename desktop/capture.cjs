// OS-wide Capture: a global shortcut opens a small floating window on /capture over whatever app is in front.
const { app: electronApp, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const isMac = process.platform === 'darwin';
const WIDTH = 640, HEIGHT = 180;
function installCapture({ app = electronApp, backend, mainWindow }) {
  let window;
  const file = path.join(app.getPath('userData'), 'capture.json');
  let shortcut = 'Alt+Space';
  // A saved shortcut another app has taken at startup, so Settings can say so instead of showing it as working.
  let unavailable = '';
  try { shortcut = JSON.parse(readFileSync(file, 'utf8')).shortcut; } catch {}
  const create = async () => {
    if (window && !window.isDestroyed()) return window;
    window = new BrowserWindow({ width: WIDTH, height: HEIGHT, frame: false, alwaysOnTop: true, show: false, resizable: false, skipTaskbar: true,
      fullscreenable: false, minimizable: false, maximizable: false,
      // A non-activating macOS panel takes typing without bringing Thunk forward, floats over full-screen apps,
      // and leaves the app you were in active, so closing it returns you there.
      ...(isMac ? { type: 'panel', hiddenInMissionControl: true } : {}),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'capture-preload.cjs') } });
    window.setAlwaysOnTop(true, 'floating');
    if (isMac) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.on('blur', () => dismiss());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(backend.url).origin) event.preventDefault(); });
    const loading = window;
    await window.loadURL(new URL('/capture', backend.url).href).catch((error) => { if (window === loading) window = undefined; loading.destroy(); throw error; });
    return window;
  };
  const dismiss = () => {
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    window.hide();
  };
  const open = async () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (window && focused === window) { dismiss(); return; } // The shortcut toggles.
    const win = await create();
    // Centre on the screen with the pointer, a third of the way down.
    const { x, y, width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    win.setBounds({ x: Math.round(x + (width - WIDTH) / 2), y: Math.round(y + height / 3 - HEIGHT / 2), width: WIDTH, height: HEIGHT });
    win.show(); win.focus();
    win.webContents.send('capture:shown');
  };
  const register = (value) => {
    if (value === shortcut && (!value || globalShortcut.isRegistered(value))) return;
    // Claim the new shortcut before releasing the old one, so a collision keeps the working shortcut.
    if (value && !globalShortcut.register(value, () => void open().catch(console.error))) throw new Error('Another app already uses that shortcut. Choose another.');
    if (shortcut && shortcut !== value) globalShortcut.unregister(shortcut);
    shortcut = value;
    unavailable = '';
  };
  { const saved = shortcut; shortcut = ''; try { register(saved); } catch { unavailable = saved; } }
  // Load the window now so the first press opens instantly.
  if (shortcut) void create().catch(console.error);
  const trusted = (event) => {
    const main = mainWindow();
    if (![main?.webContents, window?.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== new URL(backend.url).origin) throw new Error('Not allowed');
  };
  // Opening at login keeps the shortcut working after a restart. Linux has no login-item API.
  const loginSupported = process.platform === 'darwin' || process.platform === 'win32';
  const state = () => ({ shortcut, unavailable, openAtLogin: loginSupported ? app.getLoginItemSettings().openAtLogin : null });
  ipcMain.handle('capture:settings', (event, value, options) => {
    trusted(event);
    if (value !== undefined && value !== null) { if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid shortcut'); register(value); writeFileSync(file, JSON.stringify({ shortcut })); if (shortcut) void create().catch(console.error); }
    if (options && typeof options.openAtLogin === 'boolean' && loginSupported) app.setLoginItemSettings({ openAtLogin: options.openAtLogin });
    return state();
  });
  ipcMain.on('capture:hide', (event) => { trusted(event); if (event.sender === window?.webContents) dismiss(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
module.exports = { installCapture };
