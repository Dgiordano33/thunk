const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('connections', {
  invoke: (action, value) => ipcRenderer.invoke('thunk:connections', action, value),
  onProgress: callback => ipcRenderer.on('thunk:connection-progress', (_event, text) => callback(text)),
});
