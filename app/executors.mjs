import fs from 'node:fs';
import path from 'node:path';

export function checkExecutor(provider, env = process.env) {
  if (provider === 'antigravity') return { provider, supported: false, installed: false,
    reason: 'Antigravity Student se usa manualmente desde su aplicación oficial.' };
  if (provider === 'claude') return { provider, supported: false, installed: false,
    reason: 'El adaptador de Claude Code aún no está implementado.' };
  if (!['codex', 'copilot', 'opencode'].includes(provider)) throw new Error('Integración desconocida.');
  for (const directory of (env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, provider);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return { provider, supported: true, installed: true, path: candidate };
    } catch { /* Probar la siguiente ruta. */ }
  }
  return { provider, supported: true, installed: false,
    reason: `No se encontró ${provider} en PATH. Instala la CLI e inicia sesión en su cliente oficial.` };
}
