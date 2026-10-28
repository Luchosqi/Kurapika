const meta = {
  codex: { name: 'Codex', monogram: 'Cx', detail: 'ChatGPT Plus · análisis y código' },
  copilot: { name: 'Copilot', monogram: 'Co', detail: 'Student · selección Auto' },
  opencode: { name: 'OpenCode', monogram: 'Oc', detail: 'CLI local · modelos configurados' },
  antigravity: { name: 'Antigravity', monogram: 'Ag', detail: 'Student · entrega manual' },
};
const statuses = { idle: 'Inactivo', running: 'Trabajando', stopping: 'Deteniendo', stopped: 'Detenido',
  completed: 'Completado', failed: 'Falló', interrupted: 'Interrumpido', handoff: 'Pendiente manual' };
let state = null;
let selected = 'codex';
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
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}
async function refresh() {
  try {
    state = await request('/api/state');
    render();
    $('connection-label').textContent = 'Servicio activo';
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
  $('stat-total').textContent = String(agents.length);
  $('stat-running').textContent = String(agents.filter(a => a.status === 'running' || a.status === 'stopping').length);
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
    const card = element('button', `agent-card${selected === id ? ' selected' : ''}`);
    card.type = 'button';
    card.setAttribute('aria-label', `${info.name}: ${statuses[agent.status] || agent.status}. Ver sesión.`);
    card.addEventListener('click', () => select(id));
    const head = element('div', 'agent-head');
    head.append(element('span', 'agent-monogram', info.monogram), element('span', `status-dot ${agent.status}`));
    card.append(head, element('p', 'agent-name', info.name),
      element('p', 'agent-detail', agent.status === 'running' ? 'Trabajando en la tarea actual' : info.detail));
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
  $('console-title').textContent = `${meta[selected].name} · consola`;
  $('console-status').textContent = statuses[agent.status] || agent.status;
  $('console-status').className = `status-badge ${agent.status}`;
  $('session-label').textContent = agent.sessionId ? `Sesión ${agent.sessionId}` : selected === 'antigravity' ? 'Entrega manual' : 'Sin sesión iniciada';
  $('mode-label').textContent = agent.sessionMode === 'edit' ? 'Puede editar' : 'Solo lectura';
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
  $('manual-result-form').hidden = selected !== 'antigravity' || agent.status !== 'handoff';
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
    await request('/api/tasks', { method: 'POST', body: JSON.stringify({ provider, mode, prompt }) });
    $('task-prompt').value = '';
    select(provider);
    await refresh();
    notify(provider === 'antigravity' ? 'Tarea preparada para entrega manual.' : `Tarea enviada a ${meta[provider].name}.`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
$('provider-select').addEventListener('change', () => select($('provider-select').value));
$('mode-select').addEventListener('change', updateModeHint);
$('stop-session').addEventListener('click', async () => {
  try { await request(`/api/agents/${selected}/stop`, { method: 'POST', body: '{}' }); await refresh(); notify('Se solicitó detener el proceso.'); }
  catch (error) { notify(error.message, true); }
});
$('reset-session').addEventListener('click', async () => {
  try { await request(`/api/agents/${selected}/reset`, { method: 'POST', body: '{}' }); await refresh(); notify('La próxima tarea iniciará una sesión nueva.'); }
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
    await request('/api/agents/antigravity/result', { method: 'POST', body: JSON.stringify({ result }) });
    $('manual-result').value = '';
    await refresh();
    notify('Resultado manual registrado.');
  } catch (error) { notify(error.message, true); }
});

updateModeHint();
refresh();
const events = new EventSource('/api/events');
events.onmessage = refresh;
events.onerror = () => {
  $('connection-label').textContent = 'Reconectando';
  document.querySelector('.connection').classList.remove('online');
};
setInterval(refresh, 10000);
