const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kurapika', {
  getState: () => ipcRenderer.invoke('kurapika:get-state'),
  sendTask: task => ipcRenderer.invoke('kurapika:send-task', task),
  stop: provider => ipcRenderer.invoke('kurapika:stop', provider),
  reset: provider => ipcRenderer.invoke('kurapika:reset', provider),
  recordResult: result => ipcRenderer.invoke('kurapika:record-result', result),
  chooseWorkspace: () => ipcRenderer.invoke('kurapika:choose-workspace'),
  onState: callback => {
    if (typeof callback !== 'function') throw new TypeError('Se requiere una función.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('kurapika:state', listener);
    return () => ipcRenderer.removeListener('kurapika:state', listener);
  },
});
