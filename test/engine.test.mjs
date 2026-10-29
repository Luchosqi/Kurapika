import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KurapikaEngine } from '../app/engine.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-test-'));
const bin = path.join(temporary, 'bin');
const projectA = path.join(temporary, 'project-a');
const projectB = path.join(temporary, 'project-b');
fs.mkdirSync(bin);
fs.mkdirSync(projectA);
fs.mkdirSync(projectB);
fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"thread.started","thread_id":"test-thread"}\' \'{"type":"item.completed","item":{"type":"agent_message","text":"Informe listo"}}\'\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\nsleep 0.2\nprintf "Cambio listo\\n"\n', { mode: 0o755 });
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const engine = new KurapikaEngine({ workspace: projectA, stateDir: path.join(temporary, 'state') });
async function waitFor(provider, status) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const agent = engine.getState().agents[provider];
    if (agent.status === status) return agent;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`${provider} no llegó a ${status}`);
}

test('registra una entrega manual sin lanzar Antigravity', () => {
  engine.sendTask({ provider: 'antigravity', mode: 'inspect', prompt: 'Inspecciona el módulo' });
  assert.equal(engine.getState().agents.antigravity.status, 'handoff');
  assert.throws(() => engine.sendTask({ provider: 'antigravity', prompt: 'Otra tarea' }), /resultado manual/);
  engine.recordResult('Módulo revisado');
  assert.equal(engine.getState().agents.antigravity.output, 'Módulo revisado');
});

test('despacha una CLI y conserva su sesión y salida', async () => {
  engine.sendTask({ provider: 'codex', mode: 'inspect', prompt: 'Revisar' });
  const agent = await waitFor('codex', 'completed');
  assert.equal(agent.sessionId, 'test-thread');
  assert.match(agent.output, /Informe listo/);
  assert.throws(() => engine.sendTask({ provider: 'codex', mode: 'edit', prompt: 'Editar' }), /otro modo/);
});

test('impide ediciones simultáneas y cambio de proyecto con tareas activas', async () => {
  engine.sendTask({ provider: 'copilot', mode: 'edit', prompt: 'Cambiar archivo A' });
  assert.throws(() => engine.sendTask({ provider: 'opencode', mode: 'edit', prompt: 'Cambiar archivo B' }), /edición en curso/);
  assert.throws(() => engine.openWorkspace(projectB), /tareas activas/);
  await waitFor('copilot', 'completed');
});

test('aísla el historial de sesiones por proyecto', () => {
  const first = engine.getState();
  engine.openWorkspace(projectB);
  assert.equal(engine.getState().agents.codex.sessionId, null);
  engine.openWorkspace(projectA);
  assert.equal(engine.getState().agents.codex.sessionId, first.agents.codex.sessionId);
  assert.equal(engine.getState().agents.antigravity.output, first.agents.antigravity.output);
});

test('coordina bloqueos de edición y proyecto con terminales abiertas', () => {
  engine.terminals = {
    hasRunning: () => true,
    hasEditing: () => true,
    isRunning: provider => provider === 'codex',
  };
  try {
    assert.throws(() => engine.sendTask({ provider: 'opencode', mode: 'edit', prompt: 'Editar' }), /edición activa/);
    assert.throws(() => engine.openWorkspace(projectB), /Cierra las terminales/);
  } finally {
    engine.terminals = null;
  }
});
