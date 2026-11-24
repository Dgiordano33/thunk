const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('thunkCapture', {
  settings: (shortcut, options) => ipcRenderer.invoke('capture:settings', shortcut, options),
  hide: () => ipcRenderer.send('capture:hide'),
  onShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('capture:shown', listener);
    return () => ipcRenderer.removeListener('capture:shown', listener);
  },
});
