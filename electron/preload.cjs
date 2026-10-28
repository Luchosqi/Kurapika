const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kurapika', {
  getState: () => ipcRenderer.invoke('kurapika:get-state'),
  sendTask: task => ipcRenderer.invoke('kurapika:send-task', task),
  stop: provider => ipcRenderer.invoke('kurapika:stop', provider),
  reset: provider => ipcRenderer.invoke('kurapika:reset', provider),
  recordResult: result => ipcRenderer.invoke('kurapika:record-result', result),
  chooseWorkspace: () => ipcRenderer.invoke('kurapika:choose-workspace'),
  getTerminals: () => ipcRenderer.invoke('kurapika:get-terminals'),
  startTerminal: (provider, mode) => ipcRenderer.invoke('kurapika:start-terminal', provider, mode),
  sendTerminal: (provider, input) => ipcRenderer.invoke('kurapika:send-terminal', provider, input),
  stopTerminal: provider => ipcRenderer.invoke('kurapika:stop-terminal', provider),
  onState: callback => {
    if (typeof callback !== 'function') throw new TypeError('Se requiere una función.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('kurapika:state', listener);
    return () => ipcRenderer.removeListener('kurapika:state', listener);
  },
  onTerminals: callback => {
    if (typeof callback !== 'function') throw new TypeError('Se requiere una función.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('kurapika:terminals', listener);
    return () => ipcRenderer.removeListener('kurapika:terminals', listener);
  },
});
