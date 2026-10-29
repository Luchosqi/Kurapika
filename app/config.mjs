import fs from 'node:fs';
import path from 'node:path';

export const EXECUTORS = ['copilot', 'antigravity', 'codex', 'opencode', 'claude'];
const DEFAULT_SLOTS = ['copilot', 'antigravity', 'codex', 'opencode', null];

function validIndex(index) { return Number.isInteger(index) && index >= 0 && index < 5; }

export class ChainConfigStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Primera ejecución. */ }
    const slots = DEFAULT_SLOTS.map((provider, index) => {
      const entry = saved.slots?.[index];
      return { position: index + 1,
        provider: EXECUTORS.includes(entry?.provider) ? entry.provider : entry?.provider === null ? null : provider,
        label: typeof entry?.label === 'string' ? entry.label.slice(0, 28) : '' };
    });
    this.config = { version: 1, slots };
    this.persist();
  }

  get() { return structuredClone(this.config); }

  assign(index, provider, label = '') {
    if (!validIndex(index)) throw new Error('Cadena desconocida.');
    if (provider !== null && !EXECUTORS.includes(provider)) throw new Error('Integración desconocida.');
    if (typeof label !== 'string' || label.length > 28) throw new Error('Nombre de cadena inválido.');
    this.config.slots[index] = { position: index + 1, provider, label: label.trim() };
    this.persist();
    return this.get();
  }

  swap(first, second) {
    if (!validIndex(first) || !validIndex(second)) throw new Error('Cadena desconocida.');
    const slots = this.config.slots;
    [slots[first], slots[second]] = [slots[second], slots[first]];
    slots[first].position = first + 1;
    slots[second].position = second + 1;
    this.persist();
    return this.get();
  }

  persist() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}
