import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { buildCommand, parseEvent, PROVIDERS, validateTask } from './commands.mjs';
import { ROLE_DEFINITIONS, RoleConfigStore, roleInstruction, validateRoleImage } from './roles.mjs';

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
  constructor({ workspace, stateDir, roleStore, agentsDirectory, promptsDirectory, spawnProcess = spawn }) {
    super();
    this.baseStateDir = path.resolve(stateDir);
    this.spawnProcess = spawnProcess;
    this.roleStore = roleStore || new RoleConfigStore(path.join(stateDir, 'roles.json'));
    this.agentsDirectory = agentsDirectory || path.resolve('agents');
    this.promptsDirectory = promptsDirectory || null;
    this.running = new Map();
    this.workflowCancelled = false;
    this.terminals = null;
    fs.mkdirSync(this.baseStateDir, { recursive: true, mode: 0o700 });
    this.openWorkspace(workspace);
  }

  openWorkspace(directory) {
    if (this.running.size) throw new Error('Detén las tareas activas antes de cambiar de proyecto.');
    if (this.state?.workflow && ['planning', 'running', 'stopping'].includes(this.state.workflow.status)) {
      throw new Error('Detén el flujo coordinado antes de cambiar de proyecto.');
    }
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
    const roles = Object.fromEntries(ROLE_DEFINITIONS.map(({ id }) => {
      const role = { ...freshAgent(id), ...(prior.roles?.[id] || {}) };
      if (role.status === 'running' || role.status === 'stopping') role.status = 'interrupted';
      return [id, role];
    }));
    const workflow = prior.workflow && typeof prior.workflow === 'object' ? prior.workflow : null;
    if (workflow && ['planning', 'running', 'stopping'].includes(workflow.status)) workflow.status = 'interrupted';
    this.state = { workspace: this.workspace, agents, roles, workflow,
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

  appendOutput(provider, text, roleId = null) {
    if (!text) return;
    const agent = roleId ? this.state.roles[roleId] : this.state.agents[provider];
    agent.output = `${agent.output}${text}\n`.slice(-60000);
    fs.appendFileSync(path.join(this.projectStateDir, `${roleId ? `role-${roleId}` : provider}.log`), `${text}\n`, { mode: 0o600 });
    this.persist();
  }

  consume(stream, provider, label, roleId = null) {
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on('line', line => {
      const event = parseEvent(provider, line);
      const agent = roleId ? this.state.roles[roleId] : this.state.agents[provider];
      if (event.sessionId && !agent.sessionId) agent.sessionId = event.sessionId;
      if (event.text) this.appendOutput(provider, label ? `[${label}] ${event.text}` : event.text, roleId);
    });
  }

  sendTask(input) {
    if (this.state.workflow && ['planning', 'running', 'stopping'].includes(this.state.workflow.status)) {
      throw new Error('Espera a que termine el flujo coordinado antes de enviar otra tarea.');
    }
    const task = validateTask(input);
    const agent = this.state.agents[task.provider];
    if (agent.status === 'running' || agent.status === 'stopping') throw new Error('El agente ya está ejecutando una tarea.');
    if (agent.status === 'handoff') throw new Error('Registra el resultado manual o inicia una sesión nueva.');
    if (task.mode === 'edit' && [...Object.values(this.state.agents), ...Object.values(this.state.roles)].some(other =>
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

  sendRoleTask(input, options = {}) {
    if (this.state.workflow && ['planning', 'running', 'stopping'].includes(this.state.workflow.status) && !options.workflow) {
      throw new Error('Espera a que termine el flujo coordinado antes de iniciar otro agente.');
    }
    const roleId = typeof input?.roleId === 'string' ? input.roleId : '';
    const definition = ROLE_DEFINITIONS.find(role => role.id === roleId);
    if (!definition) throw new Error('Agente desconocido.');
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt || prompt.length > 12000) throw new Error('Escribe una tarea de 1 a 12000 caracteres.');
    const imagePath = validateRoleImage(roleId, input.imagePath);
    const agent = this.state.roles[roleId];
    const key = `role:${roleId}`;
    if (this.running.has(key)) throw new Error('Este agente ya está trabajando.');
    if (definition.mode === 'edit' && [...Object.values(this.state.agents), ...Object.values(this.state.roles)].some(other =>
      other.mode === 'edit' && (other.status === 'running' || other.status === 'stopping'))) {
      throw new Error('Ya hay una tarea de edición en curso. Espera a que termine.');
    }
    if (definition.mode === 'edit' && this.terminals?.hasEditing()) throw new Error('Ya hay una edición activa en una terminal.');
    const { provider, model, effort } = this.roleStore.get().find(role => role.id === roleId);
    if (agent.sessionId && (agent.provider !== provider || agent.model !== model || agent.effort !== effort || agent.sessionMode !== definition.mode)) {
      throw new Error('Cambió el ejecutor o modelo. Inicia una sesión nueva para este agente.');
    }
    const instruction = roleInstruction(roleId, this.agentsDirectory, this.promptsDirectory);
    const spec = buildCommand({ provider, model, effort, mode: definition.mode, prompt,
      workspace: this.workspace, sessionId: agent.sessionId, roleId, instruction, imagePath,
      outputSchema: options.outputSchema, outputFile: options.outputFile });
    Object.assign(agent, { provider, model, effort, mode: definition.mode, sessionMode: definition.mode,
      task: prompt, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
      exitCode: null, output: '' });
    if (spec.sessionId) agent.sessionId = spec.sessionId;
    const child = this.spawnProcess(spec.command, spec.args, {
      cwd: this.workspace,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
    this.running.set(key, child);
    this.addActivity(provider, `${roleId}: tarea iniciada: ${prompt.slice(0, 90)}`);
    this.persist();
    this.consume(child.stdout, provider, '', roleId);
    this.consume(child.stderr, provider, 'stderr', roleId);
    child.once('error', error => this.appendOutput(provider, `Error al iniciar CLI: ${error.message}`, roleId));
    child.once('close', code => {
      this.running.delete(key);
      agent.status = agent.status === 'stopping' ? 'stopped' : code === 0 ? 'completed' : 'failed';
      agent.exitCode = code;
      agent.finishedAt = new Date().toISOString();
      this.addActivity(provider, `${roleId}: ${code === 0 ? 'tarea completada' : `código ${code ?? 'desconocido'}`}.`);
      this.persist();
    });
    return this.getState();
  }

  waitForRole(roleId) {
    return new Promise(resolve => {
      const check = () => {
        const agent = this.state.roles[roleId];
        if (!['completed', 'failed', 'stopped'].includes(agent.status)) return;
        this.off('state', check);
        resolve(agent.status);
      };
      this.on('state', check);
      check();
    });
  }

  startWorkflow(input) {
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt || prompt.length > 8000) throw new Error('Describe un objetivo de 1 a 8000 caracteres.');
    if (this.state.workflow && ['planning', 'running', 'stopping'].includes(this.state.workflow.status)) {
      throw new Error('Ya hay un flujo coordinado en curso.');
    }
    if (this.running.size || this.terminals?.hasEditing()) {
      throw new Error('Termina las tareas y ediciones activas antes de iniciar un flujo coordinado.');
    }
    if (this.roleStore.get().find(role => role.id === 'orchestrator').provider !== 'codex') {
      throw new Error('El flujo coordinado requiere Codex como ejecutor del orquestador.');
    }
    this.workflowCancelled = false;
    this.state.workflow = { status: 'planning', prompt, summary: '', steps: [], current: 'orchestrator',
      output: 'Preparando plan con Codex…', startedAt: new Date().toISOString(), finishedAt: null };
    this.persist();
    void this.runWorkflow(prompt).catch(error => {
      const workflow = this.state.workflow;
      if (!workflow) return;
      workflow.status = this.workflowCancelled ? 'stopped' : 'failed';
      workflow.output += `\n${error.message}`;
      workflow.current = null;
      workflow.finishedAt = new Date().toISOString();
      this.persist();
    });
    return this.getState();
  }

  async runWorkflow(prompt) {
    if (this.state.roles.orchestrator.status === 'running') throw new Error('El orquestador ya está trabajando.');
    this.resetRole('orchestrator');
    const outputFile = path.join(this.projectStateDir, `plan-${randomUUID()}.json`);
    const instruction = 'Devuelve solo un plan JSON. Elige entre 0 y 6 pasos de los roles disponibles. ' +
      'No ejecutes ni delegues tareas durante la planificación. Cada paso debe tener un objetivo verificable. ' +
      'Usa build, general o ui-builder para editar; añade tester o reviewer solo cuando aporten evidencia. ' +
      'No incluyas visual-qa: ese rol necesita una captura adjunta por el usuario. ' +
      'Evita tareas redundantes. Si basta una respuesta, devuelve cero pasos y explica la respuesta en summary.';
    this.sendRoleTask({ roleId: 'orchestrator', prompt: `${instruction}\n\nObjetivo: ${prompt}` }, {
      workflow: true,
      outputSchema: path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflow-plan.schema.json'),
      outputFile,
    });
    let plan;
    try {
      const planned = await this.waitForRole('orchestrator');
      if (this.workflowCancelled) throw new Error('Flujo detenido.');
      if (planned !== 'completed') throw new Error('El orquestador no pudo preparar el plan.');
      try { plan = JSON.parse(fs.readFileSync(outputFile, 'utf8')); }
      catch { throw new Error('Codex no entregó un plan JSON válido.'); }
    }
    finally { try { fs.unlinkSync(outputFile); } catch { /* La salida puede no existir. */ } }
    if (!plan || typeof plan.summary !== 'string' || !Array.isArray(plan.steps) || plan.steps.length > 6 ||
      plan.steps.some(step => !ROLE_DEFINITIONS.some(role => role.id === step.roleId && role.id !== 'orchestrator' && role.id !== 'visual-qa') ||
        typeof step.prompt !== 'string' || !step.prompt.trim() || step.prompt.length > 4000)) {
      throw new Error('El plan contiene pasos inválidos.');
    }
    const workflow = this.state.workflow;
    workflow.summary = plan.summary.slice(0, 3000);
    workflow.steps = plan.steps.map(step => ({ roleId: step.roleId, prompt: step.prompt, status: 'pending' }));
    workflow.status = 'running';
    workflow.output = `Plan: ${workflow.summary}\n${workflow.steps.map((step, i) => `${i + 1}. ${step.roleId}: ${step.prompt}`).join('\n')}`;
    this.persist();
    let context = '';
    for (const step of workflow.steps) {
      if (this.workflowCancelled) throw new Error('Flujo detenido.');
      workflow.current = step.roleId;
      step.status = 'running';
      this.persist();
      const task = `${step.prompt}\n\nObjetivo original: ${prompt}\n${context}`.slice(0, 12000);
      this.sendRoleTask({ roleId: step.roleId, prompt: task }, { workflow: true });
      const status = await this.waitForRole(step.roleId);
      step.status = status;
      const output = this.state.roles[step.roleId].output.trim();
      workflow.output = `${workflow.output}\n\n[${step.roleId} · ${status}]\n${output.slice(-6000)}`.slice(-60000);
      context = `Resultados anteriores:\n${workflow.output.slice(-5000)}`;
      this.persist();
      if (status !== 'completed') throw new Error(`El paso ${step.roleId} no terminó correctamente.`);
    }
    workflow.status = 'completed';
    workflow.current = null;
    workflow.finishedAt = new Date().toISOString();
    this.persist();
  }

  stopWorkflow() {
    const workflow = this.state.workflow;
    if (!workflow || !['planning', 'running'].includes(workflow.status)) throw new Error('No hay flujo activo.');
    this.workflowCancelled = true;
    workflow.status = 'stopping';
    const roleId = workflow.current;
    if (roleId && this.running.has(`role:${roleId}`)) this.stopRole(roleId);
    else this.persist();
    return this.getState();
  }

  stopRole(roleId) {
    const key = `role:${roleId}`;
    const child = this.running.get(key);
    if (!child) throw new Error('No hay proceso activo para este agente.');
    this.state.roles[roleId].status = 'stopping';
    child.kill('SIGTERM');
    setTimeout(() => { if (this.running.get(key) === child) child.kill('SIGKILL'); }, 5000).unref();
    this.persist();
    return this.getState();
  }

  resetRole(roleId) {
    if (!ROLE_DEFINITIONS.some(role => role.id === roleId)) throw new Error('Agente desconocido.');
    if (this.running.has(`role:${roleId}`)) throw new Error('Detén el proceso antes de iniciar otra sesión.');
    this.state.roles[roleId] = freshAgent(roleId);
    this.addActivity(this.roleStore.get().find(role => role.id === roleId).provider, `${roleId}: sesión reiniciada.`);
    this.persist();
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
