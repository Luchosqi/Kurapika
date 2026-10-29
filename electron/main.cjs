const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_URL = 'kurapika://app/index.html';
const ROOT = path.resolve(__dirname, '..');
const ASSETS = new Map([
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/assets/kurapika-background.webp', 'assets/kurapika-background.webp'],
  ['/assets/chain-link.svg', 'assets/chain-link.svg'],
  ['/vendor/xterm/xterm.js', 'vendor/xterm/xterm.js'],
  ['/vendor/xterm/xterm.css', 'vendor/xterm/xterm.css'],
]);

protocol.registerSchemesAsPrivileged([{
  scheme: 'kurapika',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

let window;
let engine;
let terminals;
let chains;
let checkExecutor;

function isAppPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'kurapika:' && url.hostname === 'app' &&
      url.pathname === '/index.html' && !url.search;
  } catch { return false; }
}

function trusted(event) {
  return window && !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isAppPage(event.senderFrame.url);
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Ventana no autorizada.');
    return callback(...args);
  });
}

function loadPreferredWorkspace(settingsFile) {
  if (process.env.KURAPIKA_WORKSPACE) return process.env.KURAPIKA_WORKSPACE;
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).workspace;
    if (typeof saved === 'string' && fs.statSync(saved).isDirectory()) return saved;
  } catch { /* Sin selección previa. */ }
  return app.isPackaged ? app.getPath('home') : process.cwd();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#041021',
    title: 'Chain Orchestrator',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url)) event.preventDefault();
  });
  window.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  protocol.handle('kurapika', request => {
    const url = new URL(request.url);
    const asset = url.hostname === 'app' ? ASSETS.get(url.pathname) : null;
    if (!asset) return new Response('No encontrado', { status: 404 });
    return net.fetch(pathToFileURL(path.join(ROOT, 'public', asset)).toString());
  });

  const [{ KurapikaEngine }, { TerminalManager }, { ChainConfigStore }, executors] = await Promise.all([
    import('../app/engine.mjs'), import('../app/terminal.mjs'), import('../app/config.mjs'), import('../app/executors.mjs'),
  ]);
  checkExecutor = executors.checkExecutor;
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  chains = new ChainConfigStore(path.join(app.getPath('userData'), 'chains.json'));
  const stateDir = process.env.KURAPIKA_STATE_DIR || path.join(app.getPath('userData'), 'sessions');
  engine = new KurapikaEngine({ workspace: loadPreferredWorkspace(settingsFile), stateDir });
  terminals = new TerminalManager({
    workspace: engine.workspace,
    editing: () => Object.values(engine.state.agents).some(agent =>
      agent.mode === 'edit' && (agent.status === 'running' || agent.status === 'stopping')),
  });
  engine.terminals = terminals;
  engine.on('state', state => {
    if (window && !window.isDestroyed()) window.webContents.send('kurapika:state', state);
  });
  terminals.on('state', state => {
    if (window && !window.isDestroyed()) window.webContents.send('kurapika:terminals', state);
  });
  terminals.on('data', event => {
    if (window && !window.isDestroyed()) window.webContents.send('kurapika:terminal-data', event);
  });

  handle('kurapika:get-state', () => engine.getState());
  handle('kurapika:send-task', task => engine.sendTask(task));
  handle('kurapika:stop', provider => engine.stop(provider));
  handle('kurapika:reset', provider => engine.reset(provider));
  handle('kurapika:record-result', result => engine.recordResult(result));
  handle('kurapika:get-agent-templates', () => fs.readdirSync(path.join(ROOT, 'agents'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => ({ id: entry.name.slice(0, -3), file: `agents/${entry.name}` })));
  handle('kurapika:window-minimize', () => window.minimize());
  handle('kurapika:window-maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize());
  handle('kurapika:window-close', () => window.close());
  handle('kurapika:get-chains', () => chains.get());
  handle('kurapika:assign-chain', (index, provider, label) => chains.assign(index, provider, label));
  handle('kurapika:swap-chains', (first, second) => chains.swap(first, second));
  handle('kurapika:check-executor', provider => checkExecutor(provider));
  handle('kurapika:get-terminals', () => terminals.getState());
  handle('kurapika:get-terminal-replay', id => terminals.getReplay(id));
  handle('kurapika:start-terminal', (provider, mode, size) => {
    const available = checkExecutor(provider);
    if (!available.installed || !available.supported) throw new Error(available.reason);
    return terminals.start(provider, mode, size);
  });
  handle('kurapika:send-terminal', (id, input) => terminals.send(id, input));
  handle('kurapika:resize-terminal', (id, size) => terminals.resize(id, size));
  handle('kurapika:stop-terminal', id => terminals.stop(id));
  handle('kurapika:close-terminal', async id => {
    const session = terminals.getState().find(item => item.id === id);
    if (!session) throw new Error('Terminal desconocida.');
    const active = session.status === 'starting' || session.status === 'running' || session.status === 'stopping';
    if (active) {
      const choice = await dialog.showMessageBox(window, {
        type: 'warning', buttons: ['Cancelar', 'Cerrar terminal'], defaultId: 0, cancelId: 0,
        message: 'La terminal sigue activa',
        detail: 'Cerrar esta pestaña detendrá su proceso y la tarea que esté ejecutando.',
      });
      if (choice.response !== 1) return false;
    }
    terminals.close(id, active);
    return true;
  });
  handle('kurapika:choose-workspace', async () => {
    const choice = await dialog.showOpenDialog(window, {
      title: 'Seleccionar proyecto',
      defaultPath: engine.workspace,
      properties: ['openDirectory'],
    });
    if (choice.canceled || !choice.filePaths.length) return engine.getState();
    const state = engine.openWorkspace(choice.filePaths[0]);
    fs.writeFileSync(settingsFile, JSON.stringify({ workspace: state.workspace }), { mode: 0o600 });
    return state;
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  dialog.showErrorBox('Kurapika no pudo iniciar', error.message);
  app.quit();
});

app.on('before-quit', () => { terminals?.shutdown(); engine?.shutdown(); });
app.on('window-all-closed', () => app.quit());
