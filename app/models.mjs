import { execFile, spawn } from 'node:child_process';

export async function listModels(provider) {
  if (provider === 'copilot') return [{ id: 'auto', label: 'Auto', note: 'Única selección del plan Student' }];
  if (provider === 'opencode') return new Promise((resolve, reject) => {
    execFile('opencode', ['models', 'opencode'], { timeout: 10000, maxBuffer: 256000 }, (error, stdout) => {
      if (error) return reject(new Error('OpenCode no pudo consultar su catálogo. Comprueba la CLI y su sesión.'));
      const models = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => /^opencode\/[a-zA-Z0-9._-]+$/.test(line));
      resolve([...new Set(models)].map(id => ({ id, label: id })));
    });
  });
  if (provider !== 'codex') throw new Error('Ejecutor desconocido.');
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Codex no respondió al consultar modelos.')), 10000);
    function finish(error, models) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(models);
    }
    child.on('error', () => finish(new Error('No se pudo iniciar Codex.')));
    child.on('close', () => finish(new Error('Codex cerró la consulta de modelos.')));
    child.stdin.on('error', () => finish(new Error('Codex cerró la consulta antes de recibirla.')));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.id !== 1) continue;
        if (event.error) return finish(new Error(event.error.message || 'Codex rechazó la consulta.'));
        const models = (event.result?.data || []).filter(item => !item.hidden).map(item => ({
          id: item.id || item.model, label: item.displayName || item.id || item.model,
          note: `${item.isDefault ? 'Predeterminado · ' : ''}${(item.inputModalities || []).join(', ')}`.trim(),
        }));
        finish(null, [{ id: 'default', label: 'Predeterminado de Codex' }, ...models]);
      }
    });
    const requests = [
      { method: 'initialize', id: 0, params: { clientInfo: { name: 'kurapika', title: 'Kurapika', version: '0.1.0' } } },
      { method: 'initialized', params: {} },
      { method: 'model/list', id: 1, params: { limit: 100, includeHidden: false } },
    ];
    child.stdin.write(requests.map(item => JSON.stringify(item)).join('\n') + '\n');
  });
}
