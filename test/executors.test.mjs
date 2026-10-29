import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkExecutor } from '../app/executors.mjs';

test('detecta CLI ejecutable y explica integraciones pendientes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-executors-'));
  fs.writeFileSync(path.join(directory, 'codex'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(checkExecutor('codex', { PATH: directory }).installed, true);
  assert.equal(checkExecutor('copilot', { PATH: directory }).installed, false);
  assert.equal(checkExecutor('antigravity').supported, false);
  assert.equal(checkExecutor('claude').supported, false);
  assert.throws(() => checkExecutor('unknown'), /desconocida/);
});
