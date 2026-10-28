# Análisis para adaptar el orquestador

Estado revisado: commit `7b576a1` de `LobiLux-Dev/OpenCode-Orchestator`, 2026-10-28.

## Qué contiene realmente

Este repositorio es una **configuración para OpenCode V2**, no una aplicación ni un motor de orquestación propio. No hay servidor, paquete ejecutable ni código que invoque directamente las APIs de varios proveedores. OpenCode crea las sesiones, ofrece las herramientas y llama a los modelos. El repositorio aporta:

- `agents/*.md`: ocho prompts con el comportamiento de cada agente personalizado.
- `opencode.example.json`: asignación estática de modelos por rol y reglas de permisos.
- `docs/`: explicación del diseño y pasos de instalación manual.

El flujo es `usuario → orchestrator → subagentes permitidos → integración y verificación → respuesta`. `orchestrator` es un agente principal que el usuario selecciona para una sesión; no tiene modelo fijo. Los especialistas corren en sesiones hijas con contexto y modelo propios. El orquestador decide por prompt cuándo llamarlos; OpenCode aplica los permisos de herramientas configurados en JSON. No existe un planificador determinista, balanceador automático entre proveedores ni registro de costes en este repositorio.

## Cómo cruza proveedores

Los prompts no nombran proveedores. La selección está en `opencode.example.json`: `build`, `plan`, `general`, `explore`, `tester`, `reviewer` y `ui-builder` usan `opencode-go`; `architect`, `reviewer-critical`, `ui-designer` y `visual-qa` usan `openai`. El `orchestrator` usa el modelo elegido para la sesión. Por eso una tarea puede emplear varios proveedores: cada delegación va al modelo asignado a su agente. No hay fallback automático definido si un modelo falta, se agota una cuota o falla un proveedor. Los IDs y variantes deben comprobarse en la instalación real.

## Permisos y límites

El orquestador deniega `subagent *` y después permite nueve IDs concretos. Cinco especialistas (`architect`, `reviewer`, `reviewer-critical`, `ui-designer`, `visual-qa`) tienen `edit` y `shell` denegados. `tester` solo tiene `edit` denegado y conserva `shell`, con el que técnicamente puede escribir archivos. `general` y `ui-builder` pueden editar y ejecutar comandos; el límite de `ui-builder` a archivos UI está en su prompt, no en un control de acceso. Las reglas de OpenCode controlan herramientas, no aíslan procesos ni garantizan que un modelo siga el flujo descrito.

La delegación es optativa: el prompt pide resolver tareas pequeñas directamente, usar especialistas para casos concretos y revisar según impacto. La concurrencia y los intentos están guiados por instrucciones del prompt, sin un límite programático de presupuesto, simultaneidad o profundidad aportado por este repo. Los MCP para grafo de código y navegador son opcionales y no vienen configurados.

## Estado de esta máquina

- El binario local `opencode` reportó versión **1.14.41**; el ejemplo requiere el esquema de **V2**. No se debe instalar esta configuración tal cual en esa versión.
- Una consulta de catálogo con datos temporales aislados mostró cuatro modelos gratuitos `opencode/*`. Esa consulta **no demuestra** qué cuentas o suscripciones están conectadas en el perfil real.
- La configuración global del usuario no se modificó. El clon conserva `origin` apuntando al repositorio indicado.

## Adaptación propuesta

1. Confirmar los proveedores, planes, modelos y límites de uso disponibles, además de si el alcance será global o por proyecto.
2. Elegir OpenCode V2 para usar el diseño tal como está, o hacer un port explícito a V1 si se debe conservar la instalación actual.
3. Crear una configuración propia separada del ejemplo original: asignar un modelo disponible a cada rol y quitar variantes inexistentes. Mantener un modelo económico para exploración/pruebas y reservar los modelos de mayor capacidad para arquitectura y revisión crítica, según las cuotas reales.
4. Revisar el conjunto de agentes: conservar solo roles útiles para los proyectos del usuario, ajustar la lista permitida y los prompts; cerrar permisos innecesarios.
5. Probar el archivo de configuración, listar agentes/modelos en la versión destino y ejecutar una tarea pequeña que requiera una sola delegación. Verificar modelo usado, permisos y resultado observables.

La configuración personalizada debe permanecer en el proyecto hasta que se valide. Para uso global, se puede instalar después de revisar el diff con la configuración existente y hacer una copia de seguridad.

## Decisiones con los planes disponibles

El usuario dispone de ChatGPT Plus/Codex, OpenCode gratuito, Antigravity Student y GitHub Copilot Student (solo `Auto`). Se preparó `profiles/opencode.chatgpt-plus.json` para combinar ChatGPT Plus con los modelos gratuitos de OpenCode, y se documentó su activación local en `profiles/README.md`. Antigravity no se conecta porque su FAQ oficial excluye su login en OpenCode bajo planes de consumidor. Copilot Student no se fija **dentro de OpenCode** porque OpenCode aún no ofrece un modelo `Auto` utilizable para esas cuentas. Su CLI nativa sí puede funcionar como proceso independiente. La activación del perfil V2 y las pruebas de ejecución requieren OpenCode V2 y la autenticación separada de sus proveedores. Véase `docs/ecosistema-nativo.md` para la arquitectura alternativa basada en CLIs nativas.
