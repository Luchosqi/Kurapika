const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kurapika', {
  getState: () => ipcRenderer.invoke('kurapika:get-state'),
  sendTask: task => ipcRenderer.invoke('kurapika:send-task', task),
  stop: provider => ipcRenderer.invoke('kurapika:stop', provider),
  reset: provider => ipcRenderer.invoke('kurapika:reset', provider),
  recordResult: result => ipcRenderer.invoke('kurapika:record-result', result),
  getRoles: () => ipcRenderer.invoke('kurapika:get-roles'),
  listModels: provider => ipcRenderer.invoke('kurapika:list-models', provider),
  chooseScreenshot: () => ipcRenderer.invoke('kurapika:choose-screenshot'),
  assignRole: (roleId, provider, model, effort) => ipcRenderer.invoke('kurapika:assign-role', roleId, provider, model, effort),
  sendRoleTask: task => ipcRenderer.invoke('kurapika:send-role-task', task),
  stopRole: roleId => ipcRenderer.invoke('kurapika:stop-role', roleId),
  resetRole: roleId => ipcRenderer.invoke('kurapika:reset-role', roleId),
  startWorkflow: task => ipcRenderer.invoke('kurapika:start-workflow', task),
  stopWorkflow: () => ipcRenderer.invoke('kurapika:stop-workflow'),
  chooseWorkspace: () => ipcRenderer.invoke('kurapika:choose-workspace'),
  minimize: () => ipcRenderer.invoke('kurapika:window-minimize'),
  maximize: () => ipcRenderer.invoke('kurapika:window-maximize'),
  closeWindow: () => ipcRenderer.invoke('kurapika:window-close'),
  getChains: () => ipcRenderer.invoke('kurapika:get-chains'),
  getAgentTemplates: () => ipcRenderer.invoke('kurapika:get-agent-templates'),
  assignChain: (index, provider, label) => ipcRenderer.invoke('kurapika:assign-chain', index, provider, label),
  swapChains: (first, second) => ipcRenderer.invoke('kurapika:swap-chains', first, second),
  checkExecutor: provider => ipcRenderer.invoke('kurapika:check-executor', provider),
  getTerminals: () => ipcRenderer.invoke('kurapika:get-terminals'),
  getTerminalReplay: id => ipcRenderer.invoke('kurapika:get-terminal-replay', id),
  startTerminal: (provider, mode, size) => ipcRenderer.invoke('kurapika:start-terminal', provider, mode, size),
  sendTerminal: (id, input) => ipcRenderer.invoke('kurapika:send-terminal', id, input),
  resizeTerminal: (id, size) => ipcRenderer.invoke('kurapika:resize-terminal', id, size),
  stopTerminal: id => ipcRenderer.invoke('kurapika:stop-terminal', id),
  closeTerminal: id => ipcRenderer.invoke('kurapika:close-terminal', id),
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
  onTerminalData: callback => {
    if (typeof callback !== 'function') throw new TypeError('Se requiere una función.');
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('kurapika:terminal-data', listener);
    return () => ipcRenderer.removeListener('kurapika:terminal-data', listener);
  },
});
