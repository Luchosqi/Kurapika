const meta = {
  codex: { name: 'Codex', monogram: 'Cx', detail: 'ChatGPT Plus · análisis y código' },
  copilot: { name: 'Copilot', monogram: 'Co', detail: 'Student · selección Auto' },
  opencode: { name: 'OpenCode', monogram: 'Oc', detail: 'CLI local · modelos configurados' },
  antigravity: { name: 'Antigravity', monogram: 'Ag', detail: 'Student · entrega manual' },
};
const statuses = { idle: 'Inactivo', running: 'Trabajando', stopping: 'Deteniendo', stopped: 'Detenido',
  completed: 'Completado', failed: 'Falló', interrupted: 'Interrumpido', handoff: 'Pendiente manual' };
let state = null;
let terminals = null;
let selected = 'codex';
let consoleView = 'tasks';
let noticeTimer;

const $ = id => document.getElementById(id);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notify(message, error = false) {
  const box = $('notice');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => box.classList.remove('visible'), 5200);
}
async function refresh() {
  try {
    [state, terminals] = await Promise.all([window.kurapika.getState(), window.kurapika.getTerminals()]);
    render();
    $('connection-label').textContent = 'Aplicación activa';
    document.querySelector('.connection').classList.add('online');
  } catch {
    $('connection-label').textContent = 'Sin conexión';
    document.querySelector('.connection').classList.remove('online');
  }
}
function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}
function renderStats() {
  const agents = Object.values(state.agents);
  const activeTerminals = terminals ? Object.values(terminals).filter(terminal => terminal.status === 'running' || terminal.status === 'stopping').length : 0;
  $('stat-total').textContent = String(agents.length);
  $('stat-running').textContent = String(agents.filter(a => a.status === 'running' || a.status === 'stopping').length + activeTerminals);
  $('stat-completed').textContent = String(agents.filter(a => a.status === 'completed').length);
  $('stat-handoff').textContent = String(agents.filter(a => a.status === 'handoff').length);
  $('workspace-path').textContent = state.workspace;
  $('workspace-path').title = state.workspace;
}
function renderAgents() {
  const grid = $('agent-grid');
  grid.replaceChildren();
  for (const [id, info] of Object.entries(meta)) {
    const agent = state.agents[id];
    const terminal = terminals?.[id];
    const visibleStatus = terminal?.status === 'running' ? 'running' : agent.status;
    const card = element('button', `agent-card${selected === id ? ' selected' : ''}`);
    card.type = 'button';
    card.setAttribute('aria-label', `${info.name}: ${terminal?.status === 'running' ? 'Terminal abierta' : statuses[agent.status] || agent.status}. Ver sesión.`);
    card.addEventListener('click', () => select(id));
    const head = element('div', 'agent-head');
    head.append(element('span', 'agent-monogram', info.monogram), element('span', `status-dot ${visibleStatus}`));
    card.append(head, element('p', 'agent-name', info.name),
      element('p', 'agent-detail', terminal?.status === 'running' ? 'Terminal interactiva abierta' : agent.status === 'running' ? 'Trabajando en la tarea actual' : info.detail));
    grid.append(card);
  }
}
function renderTabs() {
  const tabs = $('console-tabs');
  tabs.replaceChildren();
  for (const [id, info] of Object.entries(meta)) {
    const tab = element('button', `console-tab${selected === id ? ' active' : ''}`, info.name);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(selected === id));
    tab.addEventListener('click', () => select(id));
    tabs.append(tab);
  }
}
function renderConsole() {
  const agent = state.agents[selected];
  const terminal = terminals?.[selected];
  const terminalView = consoleView === 'terminal';
  const status = terminalView ? terminal?.status || 'idle' : agent.status;
  $('console-title').textContent = `${meta[selected].name} · ${terminalView ? 'terminal' : 'consola'}`;
  $('console-status').textContent = statuses[status] || status;
  $('console-status').className = `status-badge ${status}`;
  $('session-label').textContent = terminalView ? 'Proceso interactivo local' : agent.sessionId ? `Sesión ${agent.sessionId}` : selected === 'antigravity' ? 'Entrega manual' : 'Sin sesión iniciada';
  $('mode-label').textContent = (terminalView ? terminal?.mode : agent.sessionMode) === 'edit' ? 'Puede editar' : 'Solo lectura';
  $('view-tasks').classList.toggle('active', !terminalView);
  $('view-terminal').classList.toggle('active', terminalView);
  $('view-tasks').setAttribute('aria-pressed', String(!terminalView));
  $('view-terminal').setAttribute('aria-pressed', String(terminalView));
  $('console-output').hidden = terminalView;
  $('console-bottom').hidden = terminalView;
  $('terminal-screen').hidden = !terminalView;
  $('terminal-controls').hidden = !terminalView;
  $('manual-result-form').hidden = terminalView || selected !== 'antigravity' || agent.status !== 'handoff';
  if (terminalView) {
    const content = terminal?.screen || (selected === 'antigravity'
      ? 'Antigravity Student requiere entrega manual desde su propia aplicación.'
      : 'Abre la terminal para ver la pantalla de la CLI aquí.');
    if ($('terminal-text').textContent !== content) $('terminal-text').textContent = content;
    $('terminal-hint').textContent = selected === 'antigravity'
      ? 'Usa la vista Tareas para preparar y registrar entregas manuales.'
      : terminal?.status === 'running' ? 'La CLI sigue abierta. Puedes enviarle mensajes o respuestas.'
        : 'Abrirá la CLI en el proyecto activo con el alcance elegido en Nueva tarea.';
    $('start-terminal').disabled = selected === 'antigravity' || terminal?.status === 'running' || terminal?.status === 'stopping';
    $('stop-terminal').disabled = terminal?.status !== 'running';
    $('terminal-input').disabled = terminal?.status !== 'running';
    $('terminal-form').querySelector('button').disabled = terminal?.status !== 'running';
    return;
  }
  const output = $('console-output');
  const nearBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 40;
  const content = agent.output || (agent.status === 'handoff' ? 'Tarea preparada. Ejecútala directamente en Antigravity y pega aquí el resultado.' : 'Selecciona un agente y envíale una tarea para ver su salida aquí.');
  if (output.dataset.content !== content) {
    const pre = element('pre', agent.output ? '' : 'console-empty', content);
    output.replaceChildren(pre);
    output.dataset.content = content;
    if (nearBottom) output.scrollTop = output.scrollHeight;
  }
  $('console-task').textContent = agent.task ? `Tarea: ${agent.task}` : 'Ninguna tarea en curso.';
  $('use-output').disabled = !agent.output;
  $('stop-session').disabled = agent.status !== 'running';
  $('reset-session').disabled = agent.status === 'running' || agent.status === 'stopping';
  $('copy-handoff').hidden = selected !== 'antigravity' || !agent.handoff;
}
function renderActivity() {
  const list = $('activity-list');
  list.replaceChildren();
  if (!state.activity.length) {
    list.append(element('li', 'empty-note', 'Las tareas y los resultados aparecerán aquí.'));
    return;
  }
  for (const entry of state.activity.slice(0, 10)) {
    const row = element('li');
    const details = element('div');
    details.append(element('div', 'activity-text', entry.text),
      element('div', 'activity-provider', meta[entry.provider]?.name || entry.provider));
    row.append(element('span', 'timeline-dot'), details, element('time', 'activity-time', formatTime(entry.at)));
    list.append(row);
  }
}
function render() {
  if (!state) return;
  renderStats();
  renderAgents();
  renderTabs();
  renderConsole();
  renderActivity();
}
function select(id) {
  selected = id;
  $('provider-select').value = id;
  updateModeHint();
  render();
}
function switchView(view) {
  consoleView = view;
  render();
}
function updateModeHint() {
  const provider = $('provider-select').value;
  const mode = $('mode-select').value;
  if (provider === 'antigravity') {
    $('mode-hint').textContent = mode === 'edit'
      ? 'Prepararemos una tarea de edición para que la ejecutes directamente en Antigravity.'
      : 'Prepararemos la tarea para ejecutarla directamente en Antigravity.';
  } else {
    $('mode-hint').textContent = mode === 'edit'
      ? 'El agente podrá modificar archivos del proyecto activo.'
      : 'El agente inspeccionará el proyecto sin modificar archivos.';
  }
}

$('task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const provider = $('provider-select').value;
  const prompt = $('task-prompt').value.trim();
  const mode = $('mode-select').value;
  if (!prompt) return;
  const button = $('task-form').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await window.kurapika.sendTask({ provider, mode, prompt });
    $('task-prompt').value = '';
    select(provider);
    await refresh();
    notify(provider === 'antigravity' ? 'Tarea preparada para entrega manual.' : `Tarea enviada a ${meta[provider].name}.`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
$('provider-select').addEventListener('change', () => select($('provider-select').value));
$('mode-select').addEventListener('change', updateModeHint);
$('view-tasks').addEventListener('click', () => switchView('tasks'));
$('view-terminal').addEventListener('click', () => switchView('terminal'));
$('start-terminal').addEventListener('click', async () => {
  try {
    terminals = await window.kurapika.startTerminal(selected, $('mode-select').value);
    render();
    $('terminal-input').focus();
    notify(`Terminal de ${meta[selected].name} abierta.`);
  } catch (error) { notify(error.message, true); }
});
$('stop-terminal').addEventListener('click', async () => {
  try { terminals = await window.kurapika.stopTerminal(selected); render(); notify('Se solicitó cerrar la terminal.'); }
  catch (error) { notify(error.message, true); }
});
$('terminal-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('terminal-input').value;
  if (!input.trim()) return;
  try { await window.kurapika.sendTerminal(selected, input); $('terminal-input').value = ''; }
  catch (error) { notify(error.message, true); }
});
$('choose-workspace').addEventListener('click', async () => {
  try {
    state = await window.kurapika.chooseWorkspace();
    render();
  } catch (error) { notify(error.message, true); }
});
$('stop-session').addEventListener('click', async () => {
  try { await window.kurapika.stop(selected); await refresh(); notify('Se solicitó detener el proceso.'); }
  catch (error) { notify(error.message, true); }
});
$('reset-session').addEventListener('click', async () => {
  try { await window.kurapika.reset(selected); await refresh(); notify('La próxima tarea iniciará una sesión nueva.'); }
  catch (error) { notify(error.message, true); }
});
$('use-output').addEventListener('click', () => {
  const agent = state.agents[selected];
  if (!agent.output) return;
  $('task-prompt').value = `Contexto recibido de ${meta[selected].name}:\n${agent.output.slice(-8000)}\n\nNueva tarea: `;
  $('task-prompt').focus();
  notify('Salida añadida al borrador. Elige el agente que la recibirá.');
});
$('copy-handoff').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.agents.antigravity.handoff); notify('Tarea copiada. Ejecútala directamente en Antigravity.'); }
  catch { notify('No se pudo copiar. Selecciona el texto de la tarea en el panel.', true); }
});
$('manual-result-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = $('manual-result').value.trim();
  if (!result) return;
  try {
    await window.kurapika.recordResult(result);
    $('manual-result').value = '';
    await refresh();
    notify('Resultado manual registrado.');
  } catch (error) { notify(error.message, true); }
});

updateModeHint();
window.kurapika.onState(next => { state = next; render(); });
window.kurapika.onTerminals(next => { terminals = next; render(); });
refresh();
