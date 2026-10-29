import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KurapikaEngine } from '../app/engine.mjs';
import { ROLE_DEFINITIONS, RoleConfigStore, PromptStore, roleInstruction, validateRoleImage } from '../app/roles.mjs';
import { buildCommand } from '../app/commands.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('conserva los doce roles y sus asignaciones por cuenta', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-roles-'));
  const file = path.join(directory, 'roles.json');
  const store = new RoleConfigStore(file);
  assert.equal(store.get().length, 12);
  assert.deepEqual(new Set(store.get().map(role => role.id)), new Set(ROLE_DEFINITIONS.map(role => role.id)));
  assert.equal(store.get().find(role => role.id === 'build').model, 'auto');
  assert.equal(store.get().find(role => role.id === 'tester').effort, 'low');
  assert.throws(() => store.assign('build', 'copilot', 'gpt-6.1-sol'), /solo admite Auto/);
  assert.throws(() => store.assign('explore', 'opencode', 'big-pickle'), /proveedor\/modelo/);
  store.assign('explore', 'opencode', 'opencode/nemotron-3-super-free');
  assert.equal(new RoleConfigStore(file).get().find(role => role.id === 'explore').model, 'opencode/nemotron-3-super-free');
});

test('inyecta el prompt heredado y pasa el modelo a la CLI correcta', () => {
  const instruction = roleInstruction('architect', path.join(root, 'agents'));
  assert.match(instruction, /architecture|architect|system/i);
  assert.ok(!instruction.startsWith('---'));
  const codex = buildCommand({ provider: 'codex', model: 'gpt-6.1-sol', mode: 'inspect',
    workspace: '/tmp/project', roleId: 'architect', instruction, prompt: 'Analiza', effort: 'high' });
  assert.deepEqual(codex.args.slice(codex.args.indexOf('-m'), codex.args.indexOf('-m') + 2), ['-m', 'gpt-6.1-sol']);
  assert.match(codex.args.at(-1), /Rol: architect/);
  assert.ok(codex.args.includes('model_reasoning_effort="high"'));
  const opencode = buildCommand({ provider: 'opencode', model: 'opencode/hy3-preview-free', mode: 'inspect',
    workspace: '/tmp/project', roleId: 'tester', instruction: 'Ejecuta pruebas', prompt: 'Prueba', effort: 'low' });
  assert.deepEqual(opencode.args.slice(opencode.args.indexOf('--model'), opencode.args.indexOf('--model') + 2),
    ['--model', 'opencode/hy3-preview-free']);
  assert.deepEqual(opencode.args.slice(opencode.args.indexOf('--variant'), opencode.args.indexOf('--variant') + 2),
    ['--variant', 'low']);
});

test('control visual exige una captura y la entrega a Codex', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-visual-'));
  const image = path.join(directory, 'pantalla.png');
  fs.writeFileSync(image, Buffer.from('captura'));
  assert.throws(() => validateRoleImage('visual-qa', null), /Adjunta una captura/);
  assert.equal(validateRoleImage('visual-qa', image), image);
  assert.throws(() => validateRoleImage('build', image), /no admite capturas/);
  const command = buildCommand({ provider: 'codex', mode: 'inspect', prompt: 'Revisa',
    workspace: directory, imagePath: image });
  assert.deepEqual(command.args.slice(command.args.indexOf('-i'), command.args.indexOf('-i') + 2), ['-i', image]);
});

test('las instrucciones personales conservan el original y una copia anterior', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-prompts-'));
  const store = new PromptStore(directory, path.join(root, 'agents'));
  const original = store.get('architect');
  assert.equal(original.customized, false);
  store.save('architect', 'Primera versión');
  store.save('architect', 'Segunda versión');
  assert.equal(store.get('architect').text, 'Segunda versión');
  assert.equal(fs.readFileSync(path.join(directory, 'architect.md.bak'), 'utf8').trim(), 'Primera versión');
  assert.equal(store.reset('architect').text, original.text);
  assert.equal(fs.readFileSync(path.join(directory, 'architect.md.bak'), 'utf8').trim(), 'Segunda versión');
  assert.match(roleInstruction('orchestrator', path.join(root, 'agents'), directory), /no puedes lanzar directamente/);
});

test('cada rol conserva su propia salida y el bloqueo de edición', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-role-engine-'));
  const project = path.join(directory, 'project');
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(project); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'opencode'), '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"text","sessionID":"role-session","part":{"text":"Hallazgo comprobado"}}\'\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\nsleep 0.2\nprintf "Implementación lista\\n"\n', { mode: 0o755 });
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${priorPath}`;
  try {
    const engine = new KurapikaEngine({ workspace: project, stateDir: path.join(directory, 'state'), agentsDirectory: path.join(root, 'agents') });
    engine.sendRoleTask({ roleId: 'build', prompt: 'Implementa A' });
    assert.throws(() => engine.sendRoleTask({ roleId: 'general', prompt: 'Implementa B' }), /edición en curso/);
    assert.throws(() => engine.openWorkspace(directory), /tareas activas/);
    engine.sendRoleTask({ roleId: 'explore', prompt: 'Busca A' });
    for (let attempt = 0; attempt < 40 && engine.getState().roles.explore.status !== 'completed'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(engine.getState().roles.explore.sessionId, 'role-session');
    assert.match(engine.getState().roles.explore.output, /Hallazgo comprobado/);
    assert.equal(engine.getState().agents.opencode.status, 'idle');
    for (let attempt = 0; attempt < 40 && engine.getState().roles.build.status !== 'completed'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(engine.getState().roles.build.status, 'completed');
    engine.resetRole('explore');
    assert.equal(engine.getState().roles.explore.sessionId, null);
  } finally { process.env.PATH = priorPath; }
});

test('el flujo coordinado planifica y ejecuta los roles en orden', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-workflow-'));
  const project = path.join(directory, 'project');
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(project); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh
previous=""
for argument in "$@"; do
  if [ "$previous" = "-o" ]; then
    printf '%s' '{"summary":"Implementar y revisar","steps":[{"roleId":"build","prompt":"Crea la función"},{"roleId":"reviewer","prompt":"Revisa la función"}]}' > "$argument"
  fi
  previous="$argument"
done
printf '%s\\n' '{"type":"thread.started","thread_id":"planner-thread"}' '{"type":"item.completed","item":{"type":"agent_message","text":"Plan listo"}}'
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\nprintf "Función implementada\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'opencode'), '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"text","sessionID":"review-thread","part":{"text":"Revisión lista"}}\'\n', { mode: 0o755 });
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${priorPath}`;
  try {
    const engine = new KurapikaEngine({ workspace: project, stateDir: path.join(directory, 'state'), agentsDirectory: path.join(root, 'agents') });
    engine.startWorkflow({ prompt: 'Implementa una función y revísala' });
    assert.throws(() => engine.openWorkspace(directory), /flujo coordinado|tareas activas/);
    for (let attempt = 0; attempt < 100 && engine.getState().workflow.status !== 'completed'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 20));
    const result = engine.getState();
    assert.equal(result.workflow.status, 'completed', result.workflow.output);
    assert.deepEqual(result.workflow.steps.map(step => step.status), ['completed', 'completed']);
    assert.match(result.workflow.output, /Función implementada/);
    assert.match(result.workflow.output, /Revisión lista/);
  } finally { process.env.PATH = priorPath; }
});
