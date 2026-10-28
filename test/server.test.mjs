import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kurapika-test-'));
const bin = path.join(temporary, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"thread.started","thread_id":"test-thread"}\' \'{"type":"item.completed","item":{"type":"agent_message","text":"Informe listo"}}\'\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\nsleep 0.2\nprintf "Cambio listo\\n"\n', { mode: 0o755 });
process.env.KURAPIKA_NO_LISTEN = '1';
process.env.KURAPIKA_STATE_DIR = path.join(temporary, 'state');
process.env.KURAPIKA_WORKSPACE = temporary;
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const { server } = await import('../app/server.mjs');

function call(method, url, body) {
  return new Promise(resolve => {
    const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    request.method = method;
    request.url = url;
    request.headers = { host: '127.0.0.1:4173', ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    const response = {
      statusCode: 200,
      writeHead(code) { this.statusCode = code; },
      end(data) { resolve({ status: this.statusCode, body: JSON.parse(data) }); },
    };
    server.emit('request', request, response);
  });
}

test('la API crea tareas manuales y registra su resultado', async () => {
  const accepted = await call('POST', '/api/tasks', { provider: 'antigravity', mode: 'inspect', prompt: 'Inspecciona el módulo' });
  assert.equal(accepted.status, 202);
  let state = (await call('GET', '/api/state')).body;
  assert.equal(state.agents.antigravity.status, 'handoff');
  assert.equal(state.agents.antigravity.handoff, 'Inspecciona el módulo');
  const result = await call('POST', '/api/agents/antigravity/result', { result: 'Módulo revisado' });
  assert.equal(result.status, 200);
  state = (await call('GET', '/api/state')).body;
  assert.equal(state.agents.antigravity.output, 'Módulo revisado');
  assert.equal(state.agents.antigravity.status, 'completed');
});

test('la API inicia CLI nativa, registra ID y salida, y permite continuar', async () => {
  const accepted = await call('POST', '/api/tasks', { provider: 'codex', mode: 'inspect', prompt: 'Revisar' });
  assert.equal(accepted.status, 202);
  let state;
  for (let i = 0; i < 30; i++) {
    state = (await call('GET', '/api/state')).body;
    if (state.agents.codex.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(state.agents.codex.status, 'completed');
  assert.equal(state.agents.codex.sessionId, 'test-thread');
  assert.match(state.agents.codex.output, /Informe listo/);
});

test('rechaza proveedor arbitrario y modos incompatibles con un hilo', async () => {
  const bad = await call('POST', '/api/tasks', { provider: 'shell', prompt: 'algo' });
  assert.equal(bad.status, 400);
  const wrongMode = await call('POST', '/api/tasks', { provider: 'codex', mode: 'edit', prompt: 'Editar' });
  assert.equal(wrongMode.status, 400);
  assert.match(wrongMode.body.error, /otro modo/);
});

test('evita dos ediciones simultáneas del mismo proyecto', async () => {
  const first = await call('POST', '/api/tasks', { provider: 'copilot', mode: 'edit', prompt: 'Cambiar archivo A' });
  assert.equal(first.status, 202);
  const second = await call('POST', '/api/tasks', { provider: 'opencode', mode: 'edit', prompt: 'Cambiar archivo B' });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /edición en curso/);
});

test('rechaza un Host ajeno al panel local', async () => {
  const request = Readable.from([]);
  request.method = 'GET';
  request.url = '/api/state';
  request.headers = { host: 'otro.example:4173' };
  const response = await new Promise(resolve => server.emit('request', request, {
    writeHead(code) { this.statusCode = code; },
    end(data) { resolve({ status: this.statusCode, body: JSON.parse(data) }); },
  }));
  assert.equal(response.status, 403);
});
