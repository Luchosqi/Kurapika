import { randomUUID } from 'node:crypto';

export const PROVIDERS = ['codex', 'copilot', 'opencode', 'antigravity'];
export const MODES = ['inspect', 'edit'];

export function validateTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('La tarea debe ser un objeto.');
  }
  const provider = String(input.provider || '');
  const mode = String(input.mode || 'inspect');
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!PROVIDERS.includes(provider)) throw new Error('Proveedor desconocido.');
  if (!MODES.includes(mode)) throw new Error('Modo desconocido.');
  if (!prompt || prompt.length > 12000) throw new Error('Escribe una tarea de 1 a 12000 caracteres.');
  return { provider, mode, prompt };
}

export function buildCommand({ provider, mode, prompt, sessionId, workspace }) {
  if (!PROVIDERS.includes(provider) || provider === 'antigravity') {
    throw new Error('Este proveedor requiere entrega manual.');
  }
  if (!MODES.includes(mode)) throw new Error('Modo desconocido.');

  const guard = mode === 'inspect'
    ? 'Solo inspecciona y explica. No modifiques archivos ni ejecutes operaciones externas.'
    : 'Trabaja solo dentro del proyecto asignado. Resume cambios y verificaciones reales.';
  const message = `Tarea asignada por Kurapika. ${guard}\n\n${prompt}`;

  if (provider === 'codex') {
    const sandbox = mode === 'inspect' ? 'read-only' : 'workspace-write';
    const policy = ['-c', 'approval_policy="never"'];
    if (sessionId) {
      return { command: 'codex', args: ['exec', 'resume', '--json', '-c', `sandbox_mode="${sandbox}"`, ...policy, sessionId, message], sessionId };
    }
    const args = ['exec', '--json', '-s', sandbox, ...policy, '-C', workspace];
    args.push(message);
    return { command: 'codex', args, sessionId: null };
  }

  if (provider === 'copilot') {
    const id = sessionId || randomUUID();
    const args = ['-C', workspace, '--model', 'auto', '--session-id', id, '--no-ask-user', '--no-color', '--allow-all-tools'];
    if (mode === 'inspect') args.push('--available-tools', 'view,glob,grep');
    else args.push('--assisted-approval');
    args.push('-p', message);
    return { command: 'copilot', args, sessionId: id };
  }

  const args = ['run', '--format', 'json', '--agent', mode === 'inspect' ? 'plan' : 'build'];
  if (sessionId) args.push('--session', sessionId);
  args.push(message);
  return { command: 'opencode', args, sessionId: sessionId || null };
}

export function parseEvent(provider, line) {
  const clean = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
  if (!clean) return { text: '', sessionId: null };
  if (provider !== 'codex' && provider !== 'opencode') return { text: clean, sessionId: null };
  let event;
  try { event = JSON.parse(clean); } catch { return { text: clean, sessionId: null }; }
  if (provider === 'codex') {
    const id = event.type === 'thread.started' ? event.thread_id : null;
    const item = event.item || {};
    if (item.type === 'agent_message' && item.text) return { text: item.text, sessionId: id };
    if (item.type === 'command_execution') {
      return { text: `$ ${item.command || 'comando'}\n${item.aggregated_output || ''}`.trim(), sessionId: id };
    }
    if (event.type === 'turn.failed') return { text: event.error?.message || 'La ejecución falló.', sessionId: id };
    if (id) return { text: `Sesión ${id}`, sessionId: id };
    return { text: '', sessionId: null };
  }
  const id = event.sessionID || event.properties?.sessionID || event.data?.sessionID || null;
  const part = event.part || event.properties?.part || event.data?.part || {};
  if (typeof part.text === 'string') return { text: part.text, sessionId: id };
  if (event.type === 'error') return { text: event.error?.message || clean, sessionId: id };
  if (id) return { text: `Sesión ${id}`, sessionId: id };
  return { text: '', sessionId: null };
}
