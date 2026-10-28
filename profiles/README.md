# Perfil para ChatGPT Plus y OpenCode gratuito

`opencode.chatgpt-plus.json` es la adaptación de este repositorio para los planes declarados por el usuario. Es un archivo de **OpenCode V2** y no contiene credenciales.

## Reparto de modelos

| Roles | Modelo | Motivo |
| --- | --- | --- |
| `orchestrator` | `openai/gpt-6.1-sol` como modelo predeterminado de sesión | La coordinación usa ChatGPT Plus por defecto, pero puedes cambiar el modelo de la sesión; el agente no tiene una asignación fija. |
| `plan`, `architect`, `reviewer-critical`, `ui-designer`, `visual-qa` | `openai/gpt-6.1-sol` | Decisiones y evaluación que requieren más juicio. `plan`, `architect` y `reviewer-critical` usan la variante `high`. |
| `build`, `reviewer` | `opencode/deepseek-v4.1-flash-free` | Codificación directa y revisión ordinaria con el catálogo gratuito. |
| `general`, `explore`, `tester`, `ui-builder` | `opencode/mimo-v2.6-flash-free` | Trabajo repetido y acotado con el catálogo gratuito. |

El agente predeterminado pasa a ser `orchestrator`. Los subagentes personalizados no pueden delegar más. `tester` y `ui-builder` piden confirmación para comandos `shell`, porque ese acceso también puede modificar archivos. El resto de las restricciones de edición y la lista de agentes delegables se conserva del ejemplo original.

## Probar solo en este repositorio

1. Instalar OpenCode **V2** por el método oficial. El binario local observado al preparar este perfil era V1.14.41; no admite esta configuración. El acceso a la descarga de V2 desde esta sesión falló por DNS, por lo que este perfil aún no se ha probado en ejecución.
2. En V2, conectar OpenAI con **Sign in with ChatGPT** mediante `/connect`. El inicio de sesión de Codex CLI no conecta automáticamente OpenCode. Conectar también OpenCode Console si `/models` no muestra los modelos gratuitos `opencode/*`.
3. Ejecutar `opencode models` y confirmar que aparecen **los tres IDs** del cuadro. La presencia en el catálogo no garantiza que una solicitud pueda ejecutarse: hacer una tarea pequeña de prueba con cada proveedor. Si un modelo gratuito temporal ya no aparece, cambiar su `model` por otro gratuito realmente visible; no usar `opencode-go/*`, que corresponde a la suscripción Go.
4. Solo después de confirmar V2 y los modelos, copiar `agents/*.md` a `.opencode/agents/` y `profiles/opencode.chatgpt-plus.json` a `.opencode/opencode.json`, revisando primero si esos destinos ya existen. Este proyecto ignora `opencode.json` en Git. El perfil de referencia y los prompts fuente quedan disponibles para comparar cambios.
5. Abrir OpenCode en este repo y pedir una tarea acotada que requiera `explore` o `general`. Confirmar en la sesión que se lanzó el agente previsto y que la respuesta del proveedor funcionó. Probar después un caso que llame a `architect` o `reviewer-critical`.

La instalación global queda pendiente hasta que las pruebas locales pasen. Para entonces, respaldar y fusionar la configuración existente en `~/.config/opencode/` sin reemplazarla a ciegas.

## Planes que no se asignan a agentes de OpenCode

- **Antigravity Student:** Google prohíbe usar el inicio de sesión de Antigravity desde OpenCode u otros agentes externos bajo planes de consumidor. Puede seguir usándose en su propia aplicación, sin compartir esa sesión con este perfil.
- **GitHub Copilot Student dentro de OpenCode:** GitHub ofrece solo selección `Auto`. OpenCode tiene un problema abierto que impide seleccionar modelos para cuentas con ese modo; no se fija `github-copilot/auto` en este perfil. **Copilot CLI sí admite `--model auto` y ejecución programática**, por lo que puede participar como proceso independiente en un orquestador externo.

Fuentes: [agentes de OpenCode V2](https://opencode.ai/v2/docs/agents/), [proveedores de OpenCode V2](https://opencode.ai/v2/docs/providers/), [modelos gratuitos de OpenCode](https://opencode.ai/v2/docs/console/models/), [planes de Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-access-to-ai-models), [incidencia de Copilot Auto en OpenCode](https://github.com/anomalyco/opencode/issues/34644), [FAQ de Antigravity](https://antigravity.google/docs/faq/).
