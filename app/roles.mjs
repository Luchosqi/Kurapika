import fs from 'node:fs';
import path from 'node:path';

export const ROLE_DEFINITIONS = Object.freeze([
  { id: 'orchestrator', label: 'Orquestador', mode: 'inspect', provider: 'codex', model: 'default', summary: 'Coordina alcance, tareas y entrega.' },
  { id: 'plan', label: 'Planificación', mode: 'inspect', provider: 'codex', model: 'default', effort: 'high', summary: 'Prepara planes y criterios de aceptación.' },
  { id: 'architect', label: 'Arquitectura', mode: 'inspect', provider: 'codex', model: 'default', effort: 'high', summary: 'Resuelve decisiones técnicas difíciles.' },
  { id: 'reviewer-critical', label: 'Revisión crítica', mode: 'inspect', provider: 'codex', model: 'default', effort: 'high', summary: 'Audita cambios de alto impacto.' },
  { id: 'ui-designer', label: 'Diseño UI', mode: 'inspect', provider: 'codex', model: 'default', summary: 'Define la dirección visual y de uso.' },
  { id: 'visual-qa', label: 'Control visual', mode: 'inspect', provider: 'codex', model: 'default', summary: 'Revisa evidencia visual real.' },
  { id: 'build', label: 'Implementación', mode: 'edit', provider: 'copilot', model: 'auto', summary: 'Implementa cambios generales.' },
  { id: 'ui-builder', label: 'Implementación UI', mode: 'edit', provider: 'copilot', model: 'auto', summary: 'Construye la interfaz aprobada.' },
  { id: 'general', label: 'Trabajo general', mode: 'edit', provider: 'opencode', model: 'opencode/minimax-m2.5-free', summary: 'Resuelve tareas acotadas de código.' },
  { id: 'explore', label: 'Exploración', mode: 'inspect', provider: 'opencode', model: 'opencode/big-pickle', summary: 'Investiga el código sin editar.' },
  { id: 'tester', label: 'Pruebas', mode: 'inspect', provider: 'opencode', model: 'opencode/hy3-preview-free', effort: 'low', summary: 'Reproduce y comprueba resultados.' },
  { id: 'reviewer', label: 'Revisión', mode: 'inspect', provider: 'opencode', model: 'opencode/nemotron-3-super-free', effort: 'high', summary: 'Revisa cambios de forma independiente.' },
]);

const ROLE_IDS = new Set(ROLE_DEFINITIONS.map(role => role.id));
const PROVIDERS = new Set(['codex', 'copilot', 'opencode']);
const BUILTIN_INSTRUCTIONS = {
  build: 'Implementa la tarea dentro del proyecto. Comprueba los cambios relevantes y reporta evidencia real.',
  plan: 'Analiza la tarea y prepara un plan concreto. No edites archivos.',
  general: 'Resuelve una tarea de implementación acotada. Respeta las instrucciones del proyecto y verifica lo que cambies.',
  explore: 'Explora el repositorio, localiza código relevante y responde con rutas y hechos comprobados. No edites archivos.',
};

export function validateAssignment(roleId, provider, model, effort = 'default') {
  if (!ROLE_IDS.has(roleId)) throw new Error('Agente desconocido.');
  if (!PROVIDERS.has(provider)) throw new Error('Ejecutor desconocido.');
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/\-]{0,79}$/.test(model)) {
    throw new Error('Identificador de modelo inválido.');
  }
  if (provider === 'copilot' && model !== 'auto') throw new Error('Copilot Student solo admite Auto.');
  if (provider === 'codex' && model === 'auto') throw new Error('Usa default o un modelo de Codex.');
  if (provider === 'opencode' && !model.includes('/')) throw new Error('OpenCode requiere proveedor/modelo.');
  if (!['default', 'low', 'medium', 'high'].includes(effort)) throw new Error('Esfuerzo de razonamiento inválido.');
  if (provider === 'copilot' && effort !== 'default') throw new Error('Copilot Auto administra su propio esfuerzo.');
  return { provider, model, effort };
}

export class RoleConfigStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Configuración nueva. */ }
    this.assignments = Object.fromEntries(ROLE_DEFINITIONS.map(role => {
      const prior = saved.assignments?.[role.id];
      try { return [role.id, validateAssignment(role.id, prior.provider, prior.model,
        prior.effort || (prior.provider === role.provider ? role.effort : 'default') || 'default')]; }
      catch { return [role.id, { provider: role.provider, model: role.model, effort: role.effort || 'default' }]; }
    }));
    this.persist();
  }

  get() { return ROLE_DEFINITIONS.map(role => ({ ...role, ...this.assignments[role.id] })); }

  assign(roleId, provider, model, effort = 'default') {
    this.assignments[roleId] = validateAssignment(roleId, provider, model, effort);
    this.persist();
    return this.get();
  }

  persist() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, assignments: this.assignments }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}

export function roleInstruction(roleId, agentsDirectory) {
  if (!ROLE_IDS.has(roleId)) throw new Error('Agente desconocido.');
  if (BUILTIN_INSTRUCTIONS[roleId]) return BUILTIN_INSTRUCTIONS[roleId];
  const source = fs.readFileSync(path.join(agentsDirectory, `${roleId}.md`), 'utf8');
  const instruction = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  return roleId === 'orchestrator'
    ? `En esta sesión CLI no puedes lanzar directamente roles de Kurapika. No afirmes que delegaste una tarea si Kurapika no la ejecutó. Cuando te pidan un plan, entrega tareas concretas para que Kurapika las despache.\n\n${instruction}`
    : instruction;
}

export function validateRoleImage(roleId, file) {
  if (file == null || file === '') {
    if (roleId === 'visual-qa') throw new Error('Adjunta una captura real para la revisión visual.');
    return null;
  }
  if (!['visual-qa', 'ui-designer'].includes(roleId) || typeof file !== 'string') {
    throw new Error('Este agente no admite capturas.');
  }
  const resolved = fs.realpathSync(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(resolved)) {
    throw new Error('Adjunta una imagen PNG, JPEG o WebP de hasta 20 MB.');
  }
  return resolved;
}
