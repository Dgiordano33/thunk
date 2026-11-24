const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('thunkCapture', {
  settings: (shortcut) => ipcRenderer.invoke('capture:settings', shortcut),
  hide: () => ipcRenderer.send('capture:hide'),
});
