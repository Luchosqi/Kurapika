import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { buildCommand, parseEvent, PROVIDERS, validateTask } from './commands.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const WORKSPACE = path.resolve(process.env.KURAPIKA_WORKSPACE || ROOT);
const STATE_DIR = path.resolve(process.env.KURAPIKA_STATE_DIR || path.join(ROOT, '.kurapika'));
const HOST = '127.0.0.1';
const PORT = Number(process.env.KURAPIKA_PORT || 4173);
const SOCKET = process.env.KURAPIKA_SOCKET || null;
if (!fs.statSync(WORKSPACE).isDirectory()) throw new Error('El workspace debe ser un directorio.');
fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const running = new Map();
const clients = new Set();

function freshAgent(id) {
  return { id, status: 'idle', sessionId: null, sessionMode: null, task: '', mode: 'inspect',
    startedAt: null, finishedAt: null, exitCode: null, output: '', handoff: null };
}

function loadState() {
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* First run. */ }
  const agents = Object.fromEntries(PROVIDERS.map(id => {
    const agent = { ...freshAgent(id), ...(prior.agents?.[id] || {}) };
    if (agent.status === 'running' || agent.status === 'stopping') agent.status = 'interrupted';
    return [id, agent];
  }));
  return { workspace: WORKSPACE, agents, activity: Array.isArray(prior.activity) ? prior.activity.slice(0, 80) : [] };
}

const state = loadState();
function persist() {
  const file = `${STATE_FILE}.tmp`;
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(file, STATE_FILE);
  for (const client of clients) client.write('data: update\n\n');
}
function activity(provider, text) {
  state.activity.unshift({ provider, text, at: new Date().toISOString() });
  state.activity.length = Math.min(state.activity.length, 80);
}
function appendOutput(provider, text) {
  if (!text) return;
  const agent = state.agents[provider];
  agent.output = `${agent.output}${text}\n`.slice(-60000);
  fs.appendFileSync(path.join(STATE_DIR, `${provider}.log`), `${text}\n`, { mode: 0o600 });
  persist();
}
function consume(stream, provider, label) {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', line => {
    const event = parseEvent(provider, line);
    if (event.sessionId && !state.agents[provider].sessionId) state.agents[provider].sessionId = event.sessionId;
    if (event.text) appendOutput(provider, label ? `[${label}] ${event.text}` : event.text);
  });
}
function runTask(task) {
  const agent = state.agents[task.provider];
  if (agent.status === 'running' || agent.status === 'stopping') throw new Error('El agente ya está ejecutando una tarea.');
  if (agent.status === 'handoff') throw new Error('Registra el resultado manual o inicia una sesión nueva.');
  if (task.mode === 'edit' && Object.values(state.agents).some(other =>
    other.mode === 'edit' && (other.status === 'running' || other.status === 'stopping'))) {
    throw new Error('Ya hay una tarea de edición en curso. Espera a que termine.');
  }
  if (agent.sessionId && agent.sessionMode && agent.sessionMode !== task.mode) {
    throw new Error('Este hilo tiene otro modo. Inicia una sesión nueva para cambiar permisos.');
  }
  agent.task = task.prompt;
  agent.mode = task.mode;
  agent.sessionMode = task.mode;
  agent.startedAt = new Date().toISOString();
  agent.finishedAt = null;
  agent.exitCode = null;
  agent.output = '';

  if (task.provider === 'antigravity') {
    agent.status = 'handoff';
    agent.handoff = task.prompt;
    activity('antigravity', 'Tarea lista para ejecutar manualmente en Antigravity.');
    persist();
    return;
  }

  const spec = buildCommand({ ...task, sessionId: agent.sessionId, workspace: WORKSPACE });
  if (spec.sessionId) agent.sessionId = spec.sessionId;
  const child = spawn(spec.command, spec.args, {
    cwd: WORKSPACE,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  running.set(task.provider, child);
  agent.status = 'running';
  activity(task.provider, `Tarea iniciada: ${task.prompt.slice(0, 110)}`);
  persist();
  consume(child.stdout, task.provider, '');
  consume(child.stderr, task.provider, 'stderr');
  child.once('error', error => appendOutput(task.provider, `Error al iniciar CLI: ${error.message}`));
  child.once('close', code => {
    running.delete(task.provider);
    agent.status = agent.status === 'stopping' ? 'stopped' : code === 0 ? 'completed' : 'failed';
    agent.exitCode = code;
    agent.finishedAt = new Date().toISOString();
    activity(task.provider, code === 0 ? 'Tarea completada.' : `Tarea terminada con código ${code ?? 'desconocido'}.`);
    persist();
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Se requiere JSON.');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16000) throw new Error('Solicitud demasiado grande.');
  }
  try { return JSON.parse(text); } catch { throw new Error('JSON inválido.'); }
}
function serveStatic(res, pathname) {
  const files = { '/': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'],
    '/app.js': ['app.js', 'text/javascript'] };
  const entry = files[pathname];
  if (!entry) return send(res, 404, { error: 'No encontrado.' });
  const [file, type] = entry;
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`,
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'",
    'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(PUBLIC, file)).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
    return send(res, 403, { error: 'Host no permitido.' });
  }
  const pathname = new URL(req.url, `http://${HOST}`).pathname;
  if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, state);
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: update\n\n');
    clients.add(res);
    res.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
      return send(res, 403, { error: 'Origen no permitido.' });
    }
    try {
      if (pathname === '/api/tasks') {
        runTask(validateTask(await readBody(req)));
        return send(res, 202, { ok: true });
      }
      const match = pathname.match(/^\/api\/agents\/(codex|copilot|opencode|antigravity)\/(stop|reset|result)$/);
      if (!match) return send(res, 404, { error: 'No encontrado.' });
      const [, provider, action] = match;
      const agent = state.agents[provider];
      if (action === 'stop') {
        const child = running.get(provider);
        if (!child) return send(res, 409, { error: 'No hay proceso activo.' });
        agent.status = 'stopping';
        child.kill('SIGTERM');
        setTimeout(() => { if (running.get(provider) === child) child.kill('SIGKILL'); }, 5000).unref();
        persist();
        return send(res, 200, { ok: true });
      }
      if (action === 'reset') {
        if (running.has(provider)) return send(res, 409, { error: 'Detén el proceso antes de iniciar otra sesión.' });
        state.agents[provider] = freshAgent(provider);
        activity(provider, 'Sesión reiniciada.');
        persist();
        return send(res, 200, { ok: true });
      }
      if (provider !== 'antigravity' || agent.status !== 'handoff') return send(res, 409, { error: 'No hay entrega manual pendiente.' });
      const data = await readBody(req);
      const result = typeof data.result === 'string' ? data.result.trim() : '';
      if (!result || result.length > 12000) throw new Error('Pega un resultado de 1 a 12000 caracteres.');
      agent.output = result;
      agent.status = 'completed';
      agent.finishedAt = new Date().toISOString();
      activity(provider, 'Resultado manual recibido.');
      persist();
      return send(res, 200, { ok: true });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }
  if (req.method === 'GET') return serveStatic(res, pathname);
  return send(res, 405, { error: 'Método no permitido.' });
});

if (process.env.KURAPIKA_NO_LISTEN !== '1') {
  server.on('error', error => {
    console.error(`No se pudo iniciar Kurapika: ${error.message}`);
    process.exitCode = 1;
  });
  const address = SOCKET ? [SOCKET] : [PORT, HOST];
  server.listen(...address, () => {
    console.log(SOCKET ? `Kurapika: ${SOCKET}` : `Kurapika: http://${HOST}:${PORT}`);
    console.log(`Workspace: ${WORKSPACE}`);
  });
}
