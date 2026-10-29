import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TerminalManager } from '../app/terminal.mjs';

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('La PTY no llegó al estado esperado.');
}

test('abre dos sesiones de la misma CLI, recibe teclas y cambia el tamaño real de PTY', { skip: process.platform !== 'linux' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-pty-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nprintf "LISTO\\n"\nstty size\nread line\nprintf "RECIBIDO:%s\\n" "$line"\nstty size\n', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  const manager = new TerminalManager({ workspace: root });
  try {
    const first = manager.start('codex', 'edit', { cols: 96, rows: 27 });
    const second = manager.start('codex', 'inspect', { cols: 80, rows: 24 });
    assert.notEqual(first.id, second.id);
    await waitFor(() => manager.getReplay(first.id).data.length && manager.getReplay(second.id).data.length);
    assert.match(Buffer.from(manager.getReplay(first.id).data, 'base64').toString(), /27 96/);
    assert.throws(() => manager.start('opencode', 'edit'), /edición activa/);
    assert.throws(() => manager.openWorkspace(root), /Cierra las terminales/);
    manager.resize(first.id, { cols: 110, rows: 32 });
    manager.send(first.id, 'hola\n');
    manager.send(second.id, 'otro\n');
    await waitFor(() => manager.getState().every(item => item.status === 'completed'));
    assert.match(Buffer.from(manager.getReplay(first.id).data, 'base64').toString(), /RECIBIDO:hola/);
    assert.match(Buffer.from(manager.getReplay(first.id).data, 'base64').toString(), /32 110/);
    assert.match(Buffer.from(manager.getReplay(second.id).data, 'base64').toString(), /RECIBIDO:otro/);
    manager.close(first.id);
    await waitFor(() => manager.getState().length === 1);
    assert.equal(manager.getState().length, 1);
    const active = manager.start('codex', 'inspect');
    await waitFor(() => manager.getState().find(item => item.id === active.id)?.status === 'running');
    assert.throws(() => manager.close(active.id), /sigue activa/);
    manager.close(active.id, true);
    await waitFor(() => !manager.getState().some(item => item.id === active.id));
  } finally {
    manager.shutdown();
    process.env.PATH = previous;
  }
});

test('valida proveedor y geometría antes de crear la PTY', { skip: process.platform !== 'linux' }, () => {
  const manager = new TerminalManager({ workspace: os.tmpdir() });
  assert.throws(() => manager.start('antigravity', 'inspect'), /no admite/);
  assert.throws(() => manager.start('codex', 'inspect', { cols: 1, rows: 30 }), /Tamaño/);
  assert.equal(manager.getState().length, 0);
});
