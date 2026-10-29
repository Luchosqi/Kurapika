const cli = {
  copilot: { name: 'Copilot', emblem: 'Co', subtitle: 'CLI' },
  antigravity: { name: 'Antigravity', emblem: 'A', subtitle: 'Manual' },
  codex: { name: 'Codex', emblem: 'Cx', subtitle: 'CLI' },
  opencode: { name: 'OpenCode', emblem: 'Oc', subtitle: 'CLI' },
  claude: { name: 'Claude Code', emblem: 'Cl', subtitle: 'Pendiente' },
};
const statuses = { idle: 'Inactivo', starting: 'Iniciando', running: 'Activo', stopping: 'Deteniendo',
  stopped: 'Detenido', completed: 'Finalizado', failed: 'Falló', interrupted: 'Interrumpido', handoff: 'Entrega manual' };
let state;
let terminals = [];
let chains;
let activeTab = 'orchestrator';
let activeView = 'terminales';
const manualTabs = [];
const tabOrder = [];
const executorStatus = new Map();
const terminalViews = new Map();
let noticeTimer;

const $ = id => document.getElementById(id);
function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function notice(message, error = false) {
  const box = $('notice');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => box.classList.remove('visible'), 5400);
}
function decode(data) {
  const binary = atob(data);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function currentSession() { return terminals.find(session => session.id === activeTab); }
function orderedTabs() {
  const all = [...manualTabs, ...terminals];
  for (const item of all) if (!tabOrder.includes(item.id)) tabOrder.push(item.id);
  return all.sort((left, right) => tabOrder.indexOf(left.id) - tabOrder.indexOf(right.id));
}

function renderChains() {
  if (!chains) return;
  const list = $('chain-list');
  list.replaceChildren();
  for (const slot of chains.slots) {
    const info = cli[slot.provider];
    const available = executorStatus.get(slot.provider);
    const unavailable = !info || !['codex', 'copilot', 'opencode'].includes(slot.provider) || available?.installed === false;
    const button = node('button', `chain-button${unavailable ? ' unavailable' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', `Cadena ${slot.position}: ${slot.label || info?.name || 'Libre'}. Abrir acceso.`);
    button.title = available?.reason || (slot.provider ? `Abrir ${info.name}` : 'Configurar cadena libre');
    const strand = node('span', 'chain-strand'); strand.setAttribute('aria-hidden', 'true');
    const medal = node('span', 'chain-medallion'); medal.setAttribute('aria-hidden', 'true');
    medal.append(node('span', 'chain-number', String(slot.position).padStart(2, '0')),
      node('span', 'chain-emblem', info?.emblem || '+'));
    button.append(strand, medal, node('span', 'chain-name', slot.label || info?.name || 'Libre'),
      node('span', 'chain-subtitle', info?.subtitle || 'Configurar'));
    button.addEventListener('click', () => activateChain(slot));
    list.append(button);
  }
}

function renderTabs() {
  const strip = $('terminal-tabs');
  strip.replaceChildren();
  const home = node('button', `session-tab${activeTab === 'orchestrator' ? ' active' : ''}`);
  home.type = 'button'; home.setAttribute('role', 'tab');
  home.setAttribute('aria-selected', String(activeTab === 'orchestrator'));
  home.textContent = '>_  Orquestador';
  home.addEventListener('click', () => selectTab('orchestrator'));
  strip.append(home);
  for (const session of orderedTabs()) {
    const wrapper = node('div', `session-tab${activeTab === session.id ? ' active' : ''}`);
    wrapper.setAttribute('role', 'presentation');
    const select = node('button', 'tab-select'); select.type = 'button'; select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(activeTab === session.id));
    select.setAttribute('aria-label', `${cli[session.provider]?.name || session.provider}: ${statuses[session.status] || session.status}`);
    select.append(node('span', `session-tab-status ${session.status}`), node('span', 'session-tab-label', cli[session.provider]?.name || session.provider));
    select.addEventListener('click', () => selectTab(session.id));
    const close = node('button', 'tab-close', '×'); close.type = 'button'; close.title = 'Cerrar pestaña';
    close.setAttribute('aria-label', `Cerrar terminal ${cli[session.provider]?.name || session.provider}`);
    close.addEventListener('click', () => session.manual ? closeManualTab(session.id) : closeTerminal(session.id));
    wrapper.append(select, close); strip.append(wrapper);
  }
  const plus = node('button', 'new-tab', '+'); plus.type = 'button'; plus.title = 'Nueva terminal';
  plus.setAttribute('aria-label', 'Abrir otra terminal'); plus.addEventListener('click', () => $('new-terminal-dialog').showModal());
  strip.append(plus);
}

function fitTerminal(id) {
  const view = terminalViews.get(id);
  if (!view || view.host.hidden || !view.host.clientWidth || !view.host.clientHeight) return;
  const cell = view.term._core?._renderService?.dimensions?.css?.cell;
  const width = cell?.width || 8.5;
  const height = cell?.height || 17;
  const cols = Math.max(20, Math.min(300, Math.floor((view.host.clientWidth - 22) / width)));
  const rows = Math.max(8, Math.min(100, Math.floor((view.host.clientHeight - 16) / height)));
  if (view.term.cols !== cols || view.term.rows !== rows) {
    view.term.resize(cols, rows);
    window.kurapika.resizeTerminal(id, { cols, rows }).catch(error => notice(error.message, true));
  }
}

async function ensureTerminal(session) {
  if (terminalViews.has(session.id)) return terminalViews.get(session.id);
  if (typeof Terminal !== 'function') throw new Error('No se pudo cargar el emulador de terminal.');
  const host = node('div', 'terminal-pane');
  host.hidden = activeTab !== session.id;
  $('terminal-panes').append(host);
  const term = new Terminal({ cols: session.cols, rows: session.rows, cursorBlink: true, scrollback: 3000,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13,
    allowTransparency: true, theme: { background: '#06152bcc', foreground: '#d8ebff', cursor: '#87d6ff',
      selectionBackground: '#2f81d4aa', black: '#0b1828', red: '#ff8d94', green: '#8ce5b2',
      yellow: '#f2d387', blue: '#7bacff', magenta: '#d3aaff', cyan: '#80d9f5', white: '#dcecff' } });
  term.open(host);
  term.onData(input => window.kurapika.sendTerminal(session.id, input).catch(error => notice(error.message, true)));
  const view = { host, term, loading: true, queued: [], lastSequence: 0 };
  terminalViews.set(session.id, view);
  try {
    const replay = await window.kurapika.getTerminalReplay(session.id);
    if (replay.data) term.write(decode(replay.data));
    view.lastSequence = replay.sequence;
    for (const event of view.queued) if (event.sequence > view.lastSequence) {
      term.write(decode(event.data)); view.lastSequence = event.sequence;
    }
    view.queued = [];
    view.loading = false;
    if (activeTab === session.id) { fitTerminal(session.id); term.focus(); }
  } catch (error) { view.loading = false; notice(error.message, true); }
  return view;
}

function renderTerminalArea() {
  const home = activeTab === 'orchestrator';
  const manual = manualTabs.some(tab => tab.id === activeTab);
  $('orchestrator-view').hidden = !home;
  $('manual-tab').hidden = !manual;
  $('terminal-panes').hidden = home || manual;
  const session = currentSession();
  $('toolbar-status').textContent = home ? 'Orquestador' : manual ? 'Entrega manual' : `${statuses[session?.status] || session?.status} · ${session?.mode === 'edit' ? 'Edición' : 'Lectura'}`;
  $('toolbar-stop').hidden = home || !['starting', 'running'].includes(session?.status);
  for (const [id, view] of terminalViews) view.host.hidden = home || manual || id !== activeTab;
  if (session) ensureTerminal(session).then(() => fitTerminal(session.id)).catch(error => notice(error.message, true));
  if (home) renderOrchestrator();
}

function renderOrchestrator() {
  if (!state) return;
  $('toolbar-path').textContent = state.workspace;
  $('footer-path').textContent = state.workspace;
  $('toolbar-path').title = state.workspace;
  $('footer-path').title = state.workspace;
  const provider = $('result-provider').value;
  const agent = state.agents[provider];
  $('result-status').textContent = statuses[agent.status] || agent.status;
  $('result-output').textContent = agent.output || 'Las respuestas aparecerán aquí.';
  $('use-output').disabled = !agent.output;
  $('stop-task').disabled = agent.status !== 'running';
  const manual = provider === 'antigravity' && agent.status === 'handoff';
  $('handoff-area').hidden = !manual;
  if (manual) $('handoff-text').textContent = agent.handoff || agent.task;
  const activity = $('activity-list'); activity.replaceChildren();
  for (const entry of state.activity.slice(0, 5)) activity.append(node('li', '', `${cli[entry.provider]?.name || entry.provider} · ${entry.text}`));
}

function render() {
  if (!state || !chains) return;
  if (activeTab !== 'orchestrator' && ![...terminals, ...manualTabs].some(session => session.id === activeTab)) activeTab = 'orchestrator';
  renderChains(); renderTabs(); renderTerminalArea();
  for (const [id, view] of terminalViews) if (!terminals.some(session => session.id === id)) {
    view.term.dispose(); view.host.remove(); terminalViews.delete(id);
  }
  if (activeView !== 'terminales') renderDrawer();
}

function selectTab(id) { activeTab = id; render(); terminalViews.get(id)?.term.focus(); }
async function openTerminal(provider, mode) {
  const available = await window.kurapika.checkExecutor(provider);
  if (!available.supported || !available.installed) throw new Error(available.reason);
  const session = await window.kurapika.startTerminal(provider, mode, { cols: 100, rows: 30 });
  terminals = await window.kurapika.getTerminals();
  tabOrder.push(session.id);
  activeTab = session.id;
  activeView = 'terminales';
  $('drawer').hidden = true;
  render();
  notice(`Terminal de ${cli[provider].name} abierta.`);
}
async function activateChain(slot) {
  if (!slot.provider) { openDrawer('configuracion'); return; }
  if (slot.provider === 'antigravity') {
    $('provider-select').value = 'antigravity'; $('result-provider').value = 'antigravity';
    if (!manualTabs.some(tab => tab.id === 'manual-antigravity')) manualTabs.push({ id: 'manual-antigravity', provider: 'antigravity', status: 'handoff', manual: true });
    selectTab('manual-antigravity'); return;
  }
  if (slot.provider === 'claude') { notice('Claude Code aún no tiene adaptador. Puedes reasignar esta cadena.', true); openDrawer('configuracion'); return; }
  const existing = terminals.find(session => session.provider === slot.provider && ['starting', 'running'].includes(session.status)) || terminals.find(session => session.provider === slot.provider);
  if (existing) { selectTab(existing.id); return; }
  try { await openTerminal(slot.provider, 'inspect'); } catch (error) { notice(error.message, true); }
}
async function closeTerminal(id) {
  try {
    const closed = await window.kurapika.closeTerminal(id);
    if (closed) { terminals = await window.kurapika.getTerminals(); render(); }
  } catch (error) { notice(error.message, true); }
}
function closeManualTab(id) {
  const index = manualTabs.findIndex(tab => tab.id === id);
  if (index >= 0) manualTabs.splice(index, 1);
  if (activeTab === id) activeTab = 'orchestrator';
  render();
}

function openDrawer(view) {
  activeView = view;
  $('drawer').hidden = view === 'terminales';
  for (const item of document.querySelectorAll('.nav-item')) {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  if (view !== 'terminales') renderDrawer();
}

function renderDrawer() {
  const titles = { agentes: 'Agentes', modelos: 'Modelos', archivos: 'Archivos', herramientas: 'Herramientas', configuracion: 'Configuración' };
  $('drawer-title').textContent = titles[activeView] || 'Configuración';
  const body = $('drawer-body'); body.replaceChildren();
  if (activeView === 'configuracion') {
    const section = node('section', 'drawer-section');
    section.append(node('h3', '', 'Cinco cadenas configurables'), node('p', 'drawer-note', 'Asigna una herramienta a cada posición. Las terminales abiertas conservan su proceso aunque cambies una cadena.'));
    chains.slots.forEach((slot, index) => {
      const row = node('div', 'slot-row');
      row.append(node('strong', '', String(index + 1).padStart(2, '0')));
      const select = node('select'); select.setAttribute('aria-label', `Herramienta de cadena ${index + 1}`);
      for (const [value, label] of [['', 'Libre'], ...Object.entries(cli).map(([id, info]) => [id, info.name])]) {
        const option = node('option', '', label); option.value = value; select.append(option);
      }
      select.value = slot.provider || '';
      const label = node('input'); label.type = 'text'; label.maxLength = 28; label.value = slot.label;
      label.placeholder = 'Nombre opcional'; label.setAttribute('aria-label', `Nombre de cadena ${index + 1}`);
      const save = node('button', '', 'Guardar'); save.type = 'button';
      save.addEventListener('click', async () => {
        try { chains = await window.kurapika.assignChain(index, select.value || null, label.value); render(); notice('Cadena actualizada.'); }
        catch (error) { notice(error.message, true); }
      });
      row.append(select, label, save); section.append(row);
    });
    const help = node('p', 'drawer-note', 'Para intercambiar posiciones, usa los controles de abajo.'); section.append(help);
    const swaps = node('div', 'swap-controls');
    for (let index = 0; index < 4; index++) {
      const button = node('button', '', `${index + 1} ↔ ${index + 2}`); button.type = 'button';
      button.addEventListener('click', async () => {
        try { chains = await window.kurapika.swapChains(index, index + 1); render(); notice('Cadenas intercambiadas.'); }
        catch (error) { notice(error.message, true); }
      });
      swaps.append(button);
    }
    section.append(swaps); body.append(section);
  } else if (activeView === 'agentes') {
    body.append(node('p', 'drawer-note', 'El repositorio incluye prompts de agentes heredados de OpenCode. Su registro editable y la asignación de modelos se incorporarán en la siguiente fase.'));
    const list = node('ul', 'drawer-list');
    body.append(list);
    window.kurapika.getAgentTemplates().then(templates => {
      for (const template of templates) {
        const item = node('li'); item.append(node('strong', '', template.id), node('small', '', template.file)); list.append(item);
      }
    }).catch(error => { list.append(node('li', '', error.message)); });
  } else if (activeView === 'modelos') {
    body.append(node('p', 'drawer-note', 'El catálogo se consultará a cada CLI autenticada. Kurapika aún no valida modelos por agente; las terminales usan la selección nativa de cada herramienta.'));
  } else if (activeView === 'archivos') {
    body.append(node('p', 'drawer-note', 'La edición segura de instrucciones Markdown está pendiente. Los archivos originales están en la carpeta agents/ del repositorio.'));
  } else if (activeView === 'herramientas') {
    body.append(node('p', 'drawer-note', 'Estado de los ejecutores locales. La autenticación se comprueba al iniciar cada CLI.'));
    const list = node('ul', 'drawer-list'); body.append(list);
    for (const [provider, info] of Object.entries(cli)) {
      const item = node('li'); item.append(node('strong', '', info.name), node('small', '', 'Comprobando…')); list.append(item);
      window.kurapika.checkExecutor(provider).then(result => {
        item.querySelector('small').textContent = result.installed ? `Instalado: ${result.path}` : result.reason;
      }).catch(error => { item.querySelector('small').textContent = error.message; });
    }
  }
}

document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => openDrawer(item.dataset.view)));
$('drawer-close').addEventListener('click', () => openDrawer('terminales'));
$('manual-to-orchestrator').addEventListener('click', () => { $('provider-select').value = 'antigravity'; selectTab('orchestrator'); $('task-prompt').focus(); });
$('footer-agents').addEventListener('click', () => openDrawer('agentes'));
for (const id of ['footer-workspace', 'toolbar-workspace']) $(id).addEventListener('click', async () => {
  try { state = await window.kurapika.chooseWorkspace(); terminals = await window.kurapika.getTerminals(); render(); }
  catch (error) { notice(error.message, true); }
});
$('toolbar-stop').addEventListener('click', async () => {
  const session = currentSession(); if (!session) return;
  try { await window.kurapika.stopTerminal(session.id); notice('Se solicitó detener el proceso.'); }
  catch (error) { notice(error.message, true); }
});
$('new-terminal-dialog').addEventListener('close', () => {
  if ($('new-terminal-dialog').returnValue !== 'start') return;
  openTerminal($('new-provider').value, $('new-mode').value).catch(error => notice(error.message, true));
});
$('provider-select').addEventListener('change', () => {
  $('mode-hint').textContent = $('provider-select').value === 'antigravity'
    ? 'La entrega será manual desde Antigravity.' : $('mode-select').value === 'edit' ? 'La CLI podrá modificar el proyecto.' : 'El agente inspeccionará el proyecto.';
});
$('mode-select').addEventListener('change', () => $('provider-select').dispatchEvent(new Event('change')));
$('result-provider').addEventListener('change', renderOrchestrator);
$('task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const provider = $('provider-select').value;
  const prompt = $('task-prompt').value.trim(); if (!prompt) return;
  const button = $('task-form').querySelector('button[type="submit"]'); button.disabled = true;
  try {
    state = await window.kurapika.sendTask({ provider, mode: $('mode-select').value, prompt });
    $('task-prompt').value = ''; $('result-provider').value = provider; renderOrchestrator();
    notice(provider === 'antigravity' ? 'Entrega manual preparada.' : `Tarea enviada a ${cli[provider].name}.`);
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
$('use-output').addEventListener('click', () => {
  const provider = $('result-provider').value; const output = state.agents[provider].output;
  if (!output) return;
  $('task-prompt').value = `Contexto de ${cli[provider].name}:\n${output.slice(-8000)}\n\nNueva tarea: `;
  $('task-prompt').focus(); notice('Resultado añadido al borrador.');
});
$('reset-session').addEventListener('click', async () => {
  try { state = await window.kurapika.reset($('result-provider').value); renderOrchestrator(); notice('Nueva sesión preparada.'); }
  catch (error) { notice(error.message, true); }
});
$('stop-task').addEventListener('click', async () => {
  try { state = await window.kurapika.stop($('result-provider').value); renderOrchestrator(); notice('Se solicitó detener la tarea.'); }
  catch (error) { notice(error.message, true); }
});
$('copy-handoff').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.agents.antigravity.handoff); notice('Tarea copiada.'); }
  catch (error) { notice(error.message, true); }
});
$('record-result').addEventListener('click', async () => {
  try { state = await window.kurapika.recordResult($('manual-result').value); $('manual-result').value = ''; renderOrchestrator(); notice('Resultado registrado.'); }
  catch (error) { notice(error.message, true); }
});
$('window-minimize').addEventListener('click', () => window.kurapika.minimize());
$('window-maximize').addEventListener('click', () => window.kurapika.maximize());
$('window-close').addEventListener('click', () => window.kurapika.closeWindow());
window.addEventListener('resize', () => { if (activeTab !== 'orchestrator') fitTerminal(activeTab); });
window.kurapika.onState(next => { state = next; render(); });
window.kurapika.onTerminals(next => { terminals = next; render(); });
window.kurapika.onTerminalData(event => {
  const view = terminalViews.get(event.id);
  if (!view) return;
  if (view.loading) view.queued.push(event);
  else if (event.sequence > view.lastSequence) { view.term.write(decode(event.data)); view.lastSequence = event.sequence; }
});

Promise.all([window.kurapika.getState(), window.kurapika.getTerminals(), window.kurapika.getChains()])
  .then(([current, sessions, config]) => {
    state = current; terminals = sessions; chains = config; render();
    for (const provider of Object.keys(cli)) window.kurapika.checkExecutor(provider)
      .then(result => { executorStatus.set(provider, result); renderChains(); })
      .catch(() => {});
  })
  .catch(error => notice(`Kurapika no pudo cargar: ${error.message}`, true));
