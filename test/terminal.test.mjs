import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TerminalManager, TerminalScreen, terminalCommand } from '../app/terminal.mjs';

test('construye comandos nativos sin incluir texto del usuario', () => {
  assert.match(terminalCommand('codex', 'inspect'), /read-only/);
  assert.match(terminalCommand('copilot', 'edit'), /--model auto/);
  assert.match(terminalCommand('opencode', 'inspect'), /--agent plan/);
  assert.throws(() => terminalCommand('antigravity', 'edit'), /no admite/);
});

test('representa la pantalla de una CLI con secuencias de control básicas', () => {
  const screen = new TerminalScreen(20, 3);
  screen.write('Hola\rAdiós\nSegunda');
  assert.match(screen.snapshot(), /^Adiós\nSegunda/);
  screen.write('\u001b[2J\u001b[1;1HLista');
  assert.match(screen.snapshot(), /^Lista/);
  assert.doesNotMatch(screen.snapshot(), /Adiós/);
});

test('bloquea una segunda terminal de edición y tareas activas de la misma CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-terminal-lock-'));
  const manager = new TerminalManager({ workspace: root, busy: provider => provider === 'codex', editing: () => true });
  assert.throws(() => manager.start('codex', 'inspect'), /ocupada/);
  assert.throws(() => manager.start('copilot', 'edit'), /edición activa/);
});

test('mantiene un proceso con PTY, le escribe y observa su respuesta', { skip: process.platform !== 'linux' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-terminal-test-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nstty size\nprintf "LISTO\\n"\nread line\nprintf "RECIBIDO:%s\\n" "$line"\n', { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  const manager = new TerminalManager({ workspace: root });
  try {
    manager.start('codex', 'edit');
    await waitFor(() => manager.getState().codex.screen.includes('LISTO'));
    assert.match(manager.getState().codex.screen, /30 100/);
    assert.throws(() => manager.openWorkspace(root), /Cierra las terminales/);
    assert.throws(() => manager.start('codex', 'inspect'), /ocupada/);
    assert.throws(() => manager.start('opencode', 'edit'), /edición activa/);
    manager.send('codex', 'mensaje');
    await waitFor(() => manager.getState().codex.screen.includes('RECIBIDO:mensaje'));
    await waitFor(() => manager.getState().codex.status === 'completed');
  } finally {
    manager.shutdown();
    process.env.PATH = originalPath;
  }
});

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('La terminal no llegó al estado esperado.');
}
