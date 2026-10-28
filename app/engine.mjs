import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { buildCommand, parseEvent, PROVIDERS, validateTask } from './commands.mjs';

function freshAgent(id) {
  return { id, status: 'idle', sessionId: null, sessionMode: null, task: '', mode: 'inspect',
    startedAt: null, finishedAt: null, exitCode: null, output: '', handoff: null };
}

function resolveWorkspace(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Elige un directorio de proyecto.');
  const resolved = fs.realpathSync(directory);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('El proyecto debe ser un directorio.');
  return resolved;
}

export class KurapikaEngine extends EventEmitter {
  constructor({ workspace, stateDir, spawnProcess = spawn }) {
    super();
    this.baseStateDir = path.resolve(stateDir);
    this.spawnProcess = spawnProcess;
    this.running = new Map();
    this.terminals = null;
    fs.mkdirSync(this.baseStateDir, { recursive: true, mode: 0o700 });
    this.openWorkspace(workspace);
  }

  openWorkspace(directory) {
    if (this.running.size) throw new Error('Detén las tareas activas antes de cambiar de proyecto.');
    if (this.terminals?.hasRunning()) throw new Error('Cierra las terminales antes de cambiar de proyecto.');
    this.workspace = resolveWorkspace(directory);
    const key = createHash('sha256').update(this.workspace).digest('hex').slice(0, 20);
    this.projectStateDir = path.join(this.baseStateDir, key);
    fs.mkdirSync(this.projectStateDir, { recursive: true, mode: 0o700 });
    this.stateFile = path.join(this.projectStateDir, 'state.json');
    let prior = {};
    try { prior = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { /* Primer inicio. */ }
    const agents = Object.fromEntries(PROVIDERS.map(id => {
      const agent = { ...freshAgent(id), ...(prior.agents?.[id] || {}) };
      if (agent.status === 'running' || agent.status === 'stopping') agent.status = 'interrupted';
      return [id, agent];
    }));
    this.state = { workspace: this.workspace, agents,
      activity: Array.isArray(prior.activity) ? prior.activity.slice(0, 80) : [] };
    this.terminals?.openWorkspace(this.workspace);
    this.persist();
    return this.getState();
  }

  getState() { return structuredClone(this.state); }

  persist() {
    const temporary = `${this.stateFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.stateFile);
    this.emit('state', this.getState());
  }

  addActivity(provider, text) {
    this.state.activity.unshift({ provider, text, at: new Date().toISOString() });
    this.state.activity.length = Math.min(this.state.activity.length, 80);
  }

  appendOutput(provider, text) {
    if (!text) return;
    const agent = this.state.agents[provider];
    agent.output = `${agent.output}${text}\n`.slice(-60000);
    fs.appendFileSync(path.join(this.projectStateDir, `${provider}.log`), `${text}\n`, { mode: 0o600 });
    this.persist();
  }

  consume(stream, provider, label) {
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('line', line => {
      const event = parseEvent(provider, line);
      if (event.sessionId && !this.state.agents[provider].sessionId) this.state.agents[provider].sessionId = event.sessionId;
      if (event.text) this.appendOutput(provider, label ? `[${label}] ${event.text}` : event.text);
    });
  }

  sendTask(input) {
    const task = validateTask(input);
    const agent = this.state.agents[task.provider];
    if (agent.status === 'running' || agent.status === 'stopping') throw new Error('El agente ya está ejecutando una tarea.');
    if (this.terminals?.isRunning(task.provider)) throw new Error('Cierra la terminal de esta CLI antes de enviarle una tarea.');
    if (agent.status === 'handoff') throw new Error('Registra el resultado manual o inicia una sesión nueva.');
    if (task.mode === 'edit' && Object.values(this.state.agents).some(other =>
      other.mode === 'edit' && (other.status === 'running' || other.status === 'stopping'))) {
      throw new Error('Ya hay una tarea de edición en curso. Espera a que termine.');
    }
    if (task.mode === 'edit' && this.terminals?.hasEditing()) throw new Error('Ya hay una edición activa en una terminal.');
    if (agent.sessionId && agent.sessionMode && agent.sessionMode !== task.mode) {
      throw new Error('Este hilo tiene otro modo. Inicia una sesión nueva para cambiar permisos.');
    }

    const spec = task.provider === 'antigravity' ? null : buildCommand({
      ...task, sessionId: agent.sessionId, workspace: this.workspace,
    });
    agent.task = task.prompt;
    agent.mode = task.mode;
    agent.sessionMode = task.mode;
    agent.startedAt = new Date().toISOString();
    agent.finishedAt = null;
    agent.exitCode = null;
    agent.output = '';

    if (!spec) {
      agent.status = 'handoff';
      agent.handoff = task.prompt;
      this.addActivity(task.provider, 'Tarea lista para ejecutar manualmente en Antigravity.');
      this.persist();
      return this.getState();
    }

    if (spec.sessionId) agent.sessionId = spec.sessionId;
    const child = this.spawnProcess(spec.command, spec.args, {
      cwd: this.workspace,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    this.running.set(task.provider, child);
    agent.status = 'running';
    this.addActivity(task.provider, `Tarea iniciada: ${task.prompt.slice(0, 110)}`);
    this.persist();
    this.consume(child.stdout, task.provider, '');
    this.consume(child.stderr, task.provider, 'stderr');
    child.once('error', error => this.appendOutput(task.provider, `Error al iniciar CLI: ${error.message}`));
    child.once('close', code => {
      this.running.delete(task.provider);
      agent.status = agent.status === 'stopping' ? 'stopped' : code === 0 ? 'completed' : 'failed';
      agent.exitCode = code;
      agent.finishedAt = new Date().toISOString();
      this.addActivity(task.provider, code === 0 ? 'Tarea completada.' : `Tarea terminada con código ${code ?? 'desconocido'}.`);
      this.persist();
    });
    return this.getState();
  }

  stop(provider) {
    const child = this.running.get(provider);
    if (!child) throw new Error('No hay proceso activo.');
    this.state.agents[provider].status = 'stopping';
    child.kill('SIGTERM');
    setTimeout(() => { if (this.running.get(provider) === child) child.kill('SIGKILL'); }, 5000).unref();
    this.persist();
    return this.getState();
  }

  reset(provider) {
    if (!PROVIDERS.includes(provider)) throw new Error('Proveedor desconocido.');
    if (this.running.has(provider)) throw new Error('Detén el proceso antes de iniciar otra sesión.');
    this.state.agents[provider] = freshAgent(provider);
    this.addActivity(provider, 'Sesión reiniciada.');
    this.persist();
    return this.getState();
  }

  recordResult(result) {
    const agent = this.state.agents.antigravity;
    if (agent.status !== 'handoff') throw new Error('No hay entrega manual pendiente.');
    const value = typeof result === 'string' ? result.trim() : '';
    if (!value || value.length > 12000) throw new Error('Pega un resultado de 1 a 12000 caracteres.');
    agent.output = value;
    agent.status = 'completed';
    agent.finishedAt = new Date().toISOString();
    this.addActivity('antigravity', 'Resultado manual recibido.');
    this.persist();
    return this.getState();
  }

  shutdown() {
    for (const child of this.running.values()) child.kill('SIGTERM');
  }
}
