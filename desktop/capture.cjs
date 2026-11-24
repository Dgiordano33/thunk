const { BrowserWindow, globalShortcut, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
function installCapture({ app, backend, mainWindow }) {
  let window;
  const file = path.join(app.getPath('userData'), 'capture.json');
  let shortcut = 'Alt+Space';
  try { shortcut = JSON.parse(readFileSync(file, 'utf8')).shortcut; } catch {}
  const open = async () => {
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 640, height: 180, frame: false, alwaysOnTop: true, show: false, resizable: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'capture-preload.cjs') } });
      window.on('blur', () => window?.hide());
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(backend.url).origin) event.preventDefault(); });
      await window.loadURL(new URL('/capture', backend.url).href);
    }
    window.show(); window.focus();
  };
  const register = (value) => {
    if (value === shortcut && (!value || globalShortcut.isRegistered(value))) return;
    // Claim the new shortcut before releasing the old one, so a collision keeps the working shortcut.
    if (value && !globalShortcut.register(value, () => void open().catch(console.error))) throw new Error('Shortcut is already in use. Choose another.');
    if (shortcut && shortcut !== value) globalShortcut.unregister(shortcut);
    shortcut = value;
  };
  { const saved = shortcut; shortcut = ''; try { register(saved); } catch {} }
  const trusted = (event) => {
    const main = mainWindow();
    if (![main?.webContents, window?.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== new URL(backend.url).origin) throw new Error('Not allowed');
  };
  ipcMain.handle('capture:settings', (event, value) => {
    trusted(event);
    if (value !== undefined) { if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid shortcut'); register(value); writeFileSync(file, JSON.stringify({ shortcut })); }
    return { shortcut };
  });
  ipcMain.on('capture:hide', (event) => { trusted(event); if (event.sender === window?.webContents) window.hide(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
module.exports = { installCapture };
