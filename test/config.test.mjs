import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChainConfigStore } from '../app/config.mjs';

test('asigna, intercambia y recupera las cinco cadenas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-slots-'));
  const file = path.join(root, 'config.json');
  const store = new ChainConfigStore(file);
  assert.deepEqual(store.get().slots.map(slot => slot.provider), ['copilot', 'antigravity', 'codex', 'opencode', null]);
  store.assign(4, 'claude', 'Claude futuro');
  store.swap(2, 4);
  const again = new ChainConfigStore(file);
  assert.equal(again.get().slots[2].provider, 'claude');
  assert.equal(again.get().slots[4].provider, 'codex');
  assert.equal(again.get().slots[2].label, 'Claude futuro');
  assert.throws(() => again.assign(5, 'codex'), /desconocida/);
  assert.throws(() => again.assign(0, 'inventado'), /desconocida/);
});
