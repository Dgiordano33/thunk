// Main window preload, only when it shows a Thunk server (THUNK_REMOTE_URL): lets that server's
// Settings → Agents panel ask this Mac to send its Claude Code and Codex setup (setup-sync.cjs).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('thunkDesktop', {
  syncSetup: () => ipcRenderer.invoke('thunk:sync-setup'),
  onSyncProgress: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on('thunk:sync-progress', listener);
    return () => ipcRenderer.removeListener('thunk:sync-progress', listener);
  },
});
