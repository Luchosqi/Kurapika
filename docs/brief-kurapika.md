# Brief de Chain Orchestrator: auditoría y avance

Referencia recibida: `BRIEF_CODEX_CHAIN_ORCHESTRATOR.md` y captura `CHAIN_ORCHESTRATOR_REFERENCIA_FINAL_1920x1080.png`. La captura define la apariencia; el brief define el comportamiento. Este documento separa lo implementado de lo pendiente.

## Estado del repositorio al recibir el brief

- Electron ya ofrecía una ventana aislada, IPC restringido, selección de workspace y un motor de tareas por turnos para Codex, Copilot Auto y OpenCode.
- La interfaz era un panel de tarjetas y formularios, distante de la captura aprobada.
- Una sola terminal por proveedor se sostenía mediante `script`; mostraba una pantalla de texto parcial y aceptaba líneas completas. No era una TUI completa ni permitía dos sesiones de la misma CLI.
- Los ocho `agents/*.md` eran prompts heredados de OpenCode. No existía registro propio de agentes, compatibilidad de modelos ni harness automático.
- El estado de tareas se persistía por workspace. Las terminales se cerraban al salir de la app.

## Hito implementado: pantalla principal y sesiones

- Fondo limpio derivado de la referencia; cinco cadenas clicables como controles, una sola terminal central, menú superior y franja inferior sin widgets descartados.
- Cadenas asignables, renombrables e intercambiables; configuración local persistente en el directorio de datos de Electron. Claude Code puede figurar en un slot, pero no se ofrece ejecución hasta tener adaptador.
- Pestaña fija de Orquestador, pestañas dinámicas por sesión, apertura múltiple de la misma CLI, botón `+`, cierre con confirmación para procesos activos y selección que no reinicia procesos.
- PTY Linux mediante `pty.fork()` en un puente Python 3 y xterm.js en el renderizador. Soporta bytes de teclado, ANSI, tamaño de ventana, scrollback, señales y reproducción de la salida al recargar la ventana.
- Comprobación de ejecutable antes del inicio. Los errores de la CLI aparecen en la propia terminal. Una sola edición activa por proyecto se mantiene entre tareas y terminales.
- Antigravity tiene pestaña explícita de entrega manual bajo el plan Student; no se finge una conexión CLI. El acceso de Claude Code permanece no disponible.

## Pendiente

1. Editar con seguridad los prompts Markdown, permisos y herramientas desde la aplicación. El registro de los 12 roles, sus asignaciones y el historial por rol ya funcionan en el motor.
2. Confirmar con una inferencia real los modelos de cada cuenta. La vista Modelos ya consulta OpenCode y el catálogo de Codex cuando su app-server responde; Copilot Student solo muestra Auto.
3. Validar el flujo coordinado con las cuentas reales. El harness actual crea un plan JSON de hasta seis pasos, ejecuta roles en orden y detiene el flujo ante fallos. Aún no aísla ediciones mediante worktrees; solo permite una edición activa.
4. Validar autenticación y comportamiento TUI de Codex, Copilot y OpenCode con las cuentas del usuario en una sesión gráfica real. Las pruebas actuales emplean CLIs falsas y no equivalen a una ejecución autenticada.
5. Revisar el emulador incluido contra una versión estable de xterm en una instalación con acceso a npm y realizar QA de Electron nativo; este entorno bloqueó la instalación y el arranque gráfico de Electron.

## Decisiones de arquitectura

- `ChainSlot` se implementa en `app/config.mjs`. Es un acceso visual; no contiene un agente ni modelo.
- `TerminalSession` se implementa en `app/terminal.mjs`, con IDs únicos y proveedor/permiso/workspace por pestaña. El puente `app/pty_bridge.py` solo acepta ejecutores y flags fijados por el adaptador, además de entrada, resize y señales; el renderer no obtiene un shell arbitrario por IPC.
- `TaskRun` sigue en `app/engine.mjs`; sus IDs de sesión de CLI son distintos de los IDs de pestaña.
- `RoleConfigStore` mantiene las asignaciones por rol; `KurapikaEngine` separa las sesiones de roles de las sesiones directas por proveedor. `app/models.mjs` consulta los catálogos visibles. El flujo coordinado usa un esquema JSON y ejecución secuencial; futuras versiones pueden aislar edición paralela con worktrees.
- El fondo es un arte raster; cadenas, pestañas y controles son DOM interactivo. El arte no contiene botones ni texto que puedan confundirse con controles.

## Verificación manual prevista

1. Ejecutar `npm install && npm start` en Linux con sesión gráfica.
2. Abrir dos terminales Codex desde `+`; confirmar que ambas tienen pestañas y procesos distintos, que flechas/Ctrl+C funcionan y que el resize conserva la TUI.
3. Cambiar de pestaña y volver, enviar texto y comprobar que la sesión sigue viva.
4. Pulsar una cadena con CLI instalada y observar que activa la pestaña existente; reasignarla desde Configuración y reiniciar para comprobar persistencia.
5. Intentar cerrar una terminal activa, cancelar, y confirmar que sigue funcionando; repetir y aceptar para comprobar cierre.
6. Abrir una terminal de edición e intentar otra edición; debe mostrarse el bloqueo. Intentar cambiar workspace mientras hay procesos activos; debe impedirlo.
