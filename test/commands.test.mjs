import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommand, parseEvent, validateTask } from '../app/commands.mjs';

test('solo acepta proveedores y modos conocidos', () => {
  assert.deepEqual(validateTask({ provider: 'copilot', mode: 'inspect', prompt: '  Revisar  ' }),
    { provider: 'copilot', mode: 'inspect', prompt: 'Revisar' });
  assert.throws(() => validateTask({ provider: 'shell', prompt: 'echo hola' }), /Proveedor/);
  assert.throws(() => validateTask({ provider: 'codex', mode: 'root', prompt: 'hola' }), /Modo/);
  assert.throws(() => validateTask({ provider: 'codex', prompt: '' }), /Escribe/);
});

test('Codex aísla la lectura y conserva el identificador al continuar', () => {
  const first = buildCommand({ provider: 'codex', mode: 'inspect', prompt: 'Revisar', workspace: '/tmp/proyecto' });
  assert.equal(first.command, 'codex');
  assert.deepEqual(first.args.slice(0, 8), ['exec', '--json', '-s', 'read-only', '-c', 'approval_policy="never"', '-C', '/tmp/proyecto']);
  const next = buildCommand({ provider: 'codex', mode: 'inspect', prompt: 'Continuar', workspace: '/tmp/proyecto', sessionId: 'abc' });
  assert.deepEqual(next.args.slice(0, 8), ['exec', 'resume', '--json', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', 'abc']);
});

test('Copilot usa Auto y limita herramientas en inspección', () => {
  const run = buildCommand({ provider: 'copilot', mode: 'inspect', prompt: 'Revisar', workspace: '/tmp/proyecto' });
  assert.equal(run.command, 'copilot');
  assert.ok(run.args.includes('auto'));
  assert.ok(run.args.includes('--available-tools'));
  assert.ok(!run.args.includes('--allow-all'));
  assert.ok(run.args.includes('--allow-all-tools'));
  assert.match(run.sessionId, /^[0-9a-f-]{36}$/);
});

test('OpenCode separa plan y build', () => {
  const inspect = buildCommand({ provider: 'opencode', mode: 'inspect', prompt: 'Revisar', workspace: '/tmp/proyecto' });
  const edit = buildCommand({ provider: 'opencode', mode: 'edit', prompt: 'Cambiar', workspace: '/tmp/proyecto', sessionId: 'ses_1' });
  assert.ok(inspect.args.includes('plan'));
  assert.ok(edit.args.includes('build'));
  assert.deepEqual(edit.args.slice(-3, -1), ['--session', 'ses_1']);
});

test('extrae IDs y mensajes del stream JSON de Codex y OpenCode', () => {
  assert.deepEqual(parseEvent('codex', '{"type":"thread.started","thread_id":"thread-1"}'),
    { text: 'Sesión thread-1', sessionId: 'thread-1' });
  assert.deepEqual(parseEvent('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Listo"}}'),
    { text: 'Listo', sessionId: null });
  assert.deepEqual(parseEvent('opencode', '{"type":"text","sessionID":"ses_1","part":{"text":"Hola"}}'),
    { text: 'Hola', sessionId: 'ses_1' });
});
