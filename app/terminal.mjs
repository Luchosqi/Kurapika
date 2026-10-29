import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const TERMINAL_PROVIDERS = ['codex', 'copilot', 'opencode'];
const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pty_bridge.py');
const MAX_REPLAY = 1024 * 1024;

function dimensions(value = {}) {
  const cols = Number(value.cols ?? 100);
  const rows = Number(value.rows ?? 30);
  if (!Number.isInteger(cols) || cols < 20 || cols > 300 || !Number.isInteger(rows) || rows < 8 || rows > 100) {
    throw new Error('Tamaño de terminal inválido.');
  }
  return { cols, rows };
}

export class TerminalManager extends EventEmitter {
  constructor({ workspace, spawnProcess = spawn, editing = () => false }) {
    super();
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.editing = editing;
    this.sessions = new Map();
    this.processes = new Map();
    this.replay = new Map();
    this.replayBytes = new Map();
    this.sequences = new Map();
  }

  getState() { return [...this.sessions.values()].map(session => structuredClone(session)); }
  getReplay(id) {
    if (!this.sessions.has(id)) throw new Error('Terminal desconocida.');
    return { data: Buffer.concat(this.replay.get(id) || []).toString('base64'),
      sequence: this.sequences.get(id) || 0 };
  }
  isRunning(provider) { return [...this.processes.keys()].some(id => this.sessions.get(id)?.provider === provider); }
  hasRunning() { return this.processes.size > 0; }
  hasEditing() { return [...this.sessions.values()].some(session =>
    (session.status === 'running' || session.status === 'starting' || session.status === 'stopping') && session.mode === 'edit'); }
  emitState() { this.emit('state', this.getState()); }

  openWorkspace(workspace) {
    if (this.hasRunning()) throw new Error('Cierra las terminales antes de cambiar de proyecto.');
    this.workspace = workspace;
    this.sessions.clear();
    this.replay.clear();
    this.replayBytes.clear();
    this.sequences.clear();
    this.emitState();
  }

  start(provider, mode, requestedSize) {
    if (process.platform !== 'linux') throw new Error('La terminal integrada requiere Linux y Python 3.');
    if (!TERMINAL_PROVIDERS.includes(provider)) throw new Error('Esta integración no admite terminal automática.');
    if (!['inspect', 'edit'].includes(mode)) throw new Error('Modo desconocido.');
    if (mode === 'edit' && (this.editing() || this.hasEditing())) throw new Error('Ya hay una edición activa en este proyecto.');
    const { cols, rows } = dimensions(requestedSize);
    const id = randomUUID();
    const session = { id, provider, mode, workspace: this.workspace, status: 'starting',
      startedAt: new Date().toISOString(), exitCode: null, cols, rows };
    this.sessions.set(id, session);
    this.replay.set(id, []);
    this.replayBytes.set(id, 0);
    this.sequences.set(id, 0);
    const child = this.spawnProcess('python3', [BRIDGE, provider, mode, String(cols), String(rows)], {
      cwd: this.workspace,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    const runtime = { child, osPid: null, exitReceived: false, closing: false };
    this.processes.set(id, runtime);
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { this.append(id, Buffer.from(line)); return; }
      if (event.type === 'ready') {
        runtime.osPid = event.pid;
        session.status = 'running';
        this.emitState();
      } else if (event.type === 'output') {
        this.append(id, Buffer.from(event.data, 'base64'));
      } else if (event.type === 'exit') {
        runtime.exitReceived = true;
        session.exitCode = event.code;
        session.status = session.status === 'stopping' ? 'stopped' : event.code === 0 ? 'completed' : 'failed';
        this.emitState();
      } else if (event.type === 'error') {
        this.append(id, Buffer.from(`\r\n${event.message}\r\n`));
      }
    });
    child.stderr.on('data', chunk => this.append(id, chunk));
    child.once('error', error => this.append(id, Buffer.from(`\r\nError al iniciar PTY: ${error.message}\r\n`)));
    child.once('close', code => {
      this.processes.delete(id);
      if (!runtime.exitReceived) {
        session.status = session.status === 'stopping' ? 'stopped' : 'failed';
        session.exitCode = code;
      }
      if (runtime.closing) {
        this.sessions.delete(id); this.replay.delete(id); this.replayBytes.delete(id); this.sequences.delete(id);
      }
      this.emitState();
    });
    this.emitState();
    return structuredClone(session);
  }

  append(id, chunk) {
    if (!this.sessions.has(id)) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const chunks = this.replay.get(id);
    chunks.push(buffer);
    let size = (this.replayBytes.get(id) || 0) + buffer.length;
    while (size > MAX_REPLAY && chunks.length > 1) size -= chunks.shift().length;
    this.replayBytes.set(id, size);
    const sequence = (this.sequences.get(id) || 0) + 1;
    this.sequences.set(id, sequence);
    this.emit('data', { id, data: buffer.toString('base64'), sequence });
  }

  control(id, message) {
    const runtime = this.processes.get(id);
    if (!runtime) throw new Error('La terminal no está activa.');
    runtime.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  send(id, input) {
    if (typeof input !== 'string' || !input || Buffer.byteLength(input) > 16384) throw new Error('Entrada de terminal inválida.');
    this.control(id, { type: 'input', data: Buffer.from(input).toString('base64') });
  }

  resize(id, value) {
    const { cols, rows } = dimensions(value);
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal desconocida.');
    if (session.cols === cols && session.rows === rows) return;
    this.control(id, { type: 'resize', cols, rows });
    session.cols = cols;
    session.rows = rows;
    this.emitState();
  }

  stop(id) {
    const runtime = this.processes.get(id);
    if (!runtime) throw new Error('La terminal no está activa.');
    const session = this.sessions.get(id);
    session.status = 'stopping';
    if (runtime.osPid) {
      try { process.kill(-runtime.osPid, 'SIGTERM'); } catch { this.control(id, { type: 'signal', name: 'SIGTERM' }); }
    } else this.control(id, { type: 'signal', name: 'SIGTERM' });
    setTimeout(() => {
      if (this.processes.get(id) !== runtime) return;
      if (runtime.osPid) { try { process.kill(-runtime.osPid, 'SIGKILL'); } catch { /* Ya terminó. */ } }
      runtime.child.kill('SIGTERM');
    }, 5000).unref();
    this.emitState();
  }

  close(id, force = false) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal desconocida.');
    if (this.processes.has(id)) {
      const active = ['starting', 'running', 'stopping'].includes(session.status);
      if (active && !force) throw new Error('La terminal sigue activa.');
      this.processes.get(id).closing = true;
      if (active) this.stop(id);
    } else {
      this.sessions.delete(id);
      this.replay.delete(id);
      this.replayBytes.delete(id);
      this.sequences.delete(id);
      this.emitState();
    }
  }

  shutdown() { for (const id of this.processes.keys()) this.stop(id); }
}
