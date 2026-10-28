import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export const TERMINAL_PROVIDERS = ['codex', 'copilot', 'opencode'];

// These commands contain no user supplied shell text. `script` supplies the PTY that
// interactive CLIs require while the application keeps control of stdin and stdout.
export function terminalCommand(provider, mode) {
  if (!TERMINAL_PROVIDERS.includes(provider)) throw new Error('Esta CLI no admite terminal integrada.');
  if (!['inspect', 'edit'].includes(mode)) throw new Error('Modo desconocido.');
  if (provider === 'codex') return `codex -s ${mode === 'inspect' ? 'read-only' : 'workspace-write'} -a on-request --no-alt-screen`;
  if (provider === 'copilot') return mode === 'inspect'
    ? 'copilot --model auto --available-tools=view,glob,grep --no-color'
    : 'copilot --model auto --no-color';
  return `opencode --agent ${mode === 'inspect' ? 'plan' : 'build'}`;
}

// A small fixed-size VT screen. It keeps terminal control bytes out of the
// renderer and is enough to inspect menus, prompts and agent progress.
export class TerminalScreen {
  constructor(columns = 100, rows = 30) {
    this.columns = columns;
    this.rows = rows;
    this.clear();
    this.sequence = '';
    this.escape = false;
  }

  clear() {
    this.lines = Array.from({ length: this.rows }, () => Array(this.columns).fill(' '));
    this.x = 0;
    this.y = 0;
  }

  scroll() {
    this.lines.shift();
    this.lines.push(Array(this.columns).fill(' '));
    this.y = this.rows - 1;
  }

  put(char) {
    if (this.x >= this.columns) { this.x = 0; this.y++; }
    if (this.y >= this.rows) this.scroll();
    this.lines[this.y][this.x++] = char;
  }

  csi(sequence) {
    const command = sequence.at(-1);
    const values = sequence.slice(1, -1).replace(/^\?/, '').split(';').map(value => Number(value) || 0);
    const amount = values[0] || 1;
    if (command === 'H' || command === 'f') {
      this.y = Math.max(0, Math.min(this.rows - 1, (values[0] || 1) - 1));
      this.x = Math.max(0, Math.min(this.columns - 1, (values[1] || 1) - 1));
    } else if (command === 'A') this.y = Math.max(0, this.y - amount);
    else if (command === 'B') this.y = Math.min(this.rows - 1, this.y + amount);
    else if (command === 'C') this.x = Math.min(this.columns - 1, this.x + amount);
    else if (command === 'D') this.x = Math.max(0, this.x - amount);
    else if (command === 'G') this.x = Math.max(0, Math.min(this.columns - 1, amount - 1));
    else if (command === 'J') {
      if (values[0] === 2 || values[0] === 3) this.clear();
      else if (values[0] === 0) {
        for (let row = this.y; row < this.rows; row++) {
          const start = row === this.y ? this.x : 0;
          this.lines[row].fill(' ', start);
        }
      }
    } else if (command === 'K') {
      if (values[0] === 2) this.lines[this.y].fill(' ');
      else if (values[0] === 1) this.lines[this.y].fill(' ', 0, this.x + 1);
      else this.lines[this.y].fill(' ', this.x);
    } else if (command === 'h' && /\?1049h$/.test(sequence)) this.clear();
  }

  write(chunk) {
    for (const char of chunk) {
      if (this.escape) {
        this.sequence += char;
        if (this.sequence === '\u001b[' || this.sequence === '\u001b]') continue;
        if (this.sequence.startsWith('\u001b[')) {
          if (/[\x40-\x7e]$/.test(this.sequence)) { this.csi(this.sequence); this.escape = false; }
        } else if (this.sequence.startsWith('\u001b]')) {
          if (char === '\u0007' || this.sequence.endsWith('\u001b\\')) this.escape = false;
        } else this.escape = false;
        if (this.sequence.length > 256) this.escape = false;
        continue;
      }
      if (char === '\u001b') { this.escape = true; this.sequence = char; }
      else if (char === '\r') this.x = 0;
      else if (char === '\n') { this.x = 0; this.y++; if (this.y >= this.rows) this.scroll(); }
      else if (char === '\b') this.x = Math.max(0, this.x - 1);
      else if (char === '\t') this.x = Math.min(this.columns - 1, Math.ceil((this.x + 1) / 8) * 8);
      else if (char >= ' ') this.put(char);
    }
  }

  snapshot() { return this.lines.map(line => line.join('').trimEnd()).join('\n').trimEnd(); }
}

export class TerminalManager extends EventEmitter {
  constructor({ workspace, spawnProcess = spawn, busy = () => false, editing = () => false }) {
    super();
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.busy = busy;
    this.editing = editing;
    this.processes = new Map();
    this.sessions = Object.fromEntries(TERMINAL_PROVIDERS.map(id => [id, this.fresh()]));
  }

  fresh() { return { status: 'idle', mode: null, screen: '', exitCode: null }; }
  getState() { return structuredClone(this.sessions); }
  isRunning(provider) { return this.processes.has(provider); }
  hasRunning() { return this.processes.size > 0; }
  hasEditing() { return Object.values(this.sessions).some(session => session.status === 'running' && session.mode === 'edit'); }
  emitState() { this.emit('state', this.getState()); }

  openWorkspace(workspace) {
    if (this.hasRunning()) throw new Error('Cierra las terminales antes de cambiar de proyecto.');
    this.workspace = workspace;
    this.sessions = Object.fromEntries(TERMINAL_PROVIDERS.map(id => [id, this.fresh()]));
    this.emitState();
  }

  start(provider, mode) {
    if (process.platform !== 'linux') throw new Error('La terminal integrada requiere Linux y util-linux script.');
    const command = terminalCommand(provider, mode);
    if (this.isRunning(provider) || this.busy(provider)) throw new Error('Esta CLI ya está ocupada.');
    if (mode === 'edit' && (this.editing() || this.hasEditing())) throw new Error('Ya hay una edición activa en este proyecto.');
    const session = this.sessions[provider] = { status: 'running', mode, screen: '', exitCode: null };
    const screen = new TerminalScreen();
    const child = this.spawnProcess('script', ['-q', '-f', '-e', '-c', `stty rows 30 cols 100; exec ${command}`, '/dev/null'], {
      cwd: this.workspace,
      env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '100', LINES: '30' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    });
    this.processes.set(provider, child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const update = chunk => { screen.write(chunk); session.screen = screen.snapshot(); this.emitState(); };
    child.stdout.on('data', update);
    child.stderr.on('data', update);
    child.once('error', error => update(`\r\nError al abrir terminal: ${error.message}\r\n`));
    child.once('close', code => {
      this.processes.delete(provider);
      session.status = session.status === 'stopping' ? 'stopped' : code === 0 ? 'completed' : 'failed';
      session.exitCode = code;
      this.emitState();
    });
    this.emitState();
    return this.getState();
  }

  send(provider, input) {
    const child = this.processes.get(provider);
    if (!child) throw new Error('La terminal no está abierta.');
    if (typeof input !== 'string' || !input.trim() || input.length > 4000 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(input)) {
      throw new Error('Escribe una línea de hasta 4000 caracteres.');
    }
    child.stdin.write(`${input}\r`);
    return this.getState();
  }

  stop(provider) {
    const child = this.processes.get(provider);
    if (!child) throw new Error('La terminal no está abierta.');
    this.sessions[provider].status = 'stopping';
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    setTimeout(() => {
      if (this.processes.get(provider) !== child) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, 5000).unref();
    this.emitState();
    return this.getState();
  }

  shutdown() {
    for (const provider of this.processes.keys()) this.stop(provider);
  }
}
