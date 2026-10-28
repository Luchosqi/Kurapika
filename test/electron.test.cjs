const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('Electron carga la ventana aislada y limita el puente IPC', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-electron-test-'));
  const channels = new Map();
  let registeredScheme;
  let protocolHandler;
  let createdWindow;
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.webContents = {
        mainFrame: { url: 'kurapika://app/index.html' },
        on() {}, setWindowOpenHandler() {}, send() {},
      };
      createdWindow = this;
    }
    loadURL(url) { this.url = url; }
    isDestroyed() { return false; }
    static getAllWindows() { return createdWindow ? [createdWindow] : []; }
  }
  const electron = {
    app: { isPackaged: false, getPath: () => userData, whenReady: () => Promise.resolve(), on() {}, quit() {} },
    BrowserWindow: FakeWindow,
    dialog: { showOpenDialog: async () => ({ canceled: true }), showErrorBox: (_title, message) => assert.fail(message) },
    ipcMain: { handle: (name, callback) => channels.set(name, callback) },
    net: { fetch: async url => ({ url }) },
    protocol: {
      registerSchemesAsPrivileged: schemes => { registeredScheme = schemes[0]; },
      handle: (_scheme, callback) => { protocolHandler = callback; },
    },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    return original.call(this, request, parent, isMain);
  };
  try { require('../electron/main.cjs'); } finally { Module._load = original; }
  for (let attempt = 0; attempt < 30 && !createdWindow; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  assert.equal(registeredScheme.scheme, 'kurapika');
  assert.equal(createdWindow.url, 'kurapika://app/index.html');
  assert.equal(createdWindow.options.webPreferences.contextIsolation, true);
  assert.equal(createdWindow.options.webPreferences.nodeIntegration, false);
  assert.equal(createdWindow.options.webPreferences.sandbox, true);
  assert.match(createdWindow.options.webPreferences.preload, /preload\.cjs$/);
  const allowed = await protocolHandler({ url: 'kurapika://app/styles.css' });
  assert.match(allowed.url, /public\/styles\.css$/);
  const denied = await protocolHandler({ url: 'kurapika://elsewhere/index.html' });
  assert.equal(denied.status, 404);

  const event = { sender: createdWindow.webContents, senderFrame: createdWindow.webContents.mainFrame };
  const state = channels.get('kurapika:get-state')(event);
  assert.ok(state.agents.codex);
  const terminals = channels.get('kurapika:get-terminals')(event);
  assert.equal(terminals.codex.status, 'idle');
  assert.equal(terminals.copilot.status, 'idle');
  assert.throws(() => channels.get('kurapika:get-state')({ sender: {} }), /no autorizada/);
  assert.throws(() => channels.get('kurapika:start-terminal')({ sender: {} }, 'codex', 'inspect'), /no autorizada/);
});
