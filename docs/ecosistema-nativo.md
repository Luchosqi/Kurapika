# Orquestación con sesiones nativas en terminal

Esta es la dirección alternativa al perfil `opencode.chatgpt-plus.json`: un controlador local coordina **clientes independientes**. OpenCode no es el agente principal ni el intermediario de los otros servicios.

```text
Usuario
  │ objetivo y límites
  ▼
Controlador local ── registro de tareas, dependencias, permisos y resultados
  ├── Codex CLI / app-server ── sesión propia de ChatGPT Plus
  ├── Copilot CLI / ACP ────── sesión propia, modelo Auto de Student
  ├── OpenCode CLI / API ───── sesión propia, modelos de su plan gratuito
  └── Antigravity ─────────── entrega manual bajo el plan Student de consumidor
```

## ¿Pueden quedar terminales abiertas?

Sí. Un controlador puede mantener procesos con una PTY, escribir entrada y leer salida. Para estos tres clientes conviene usar sus interfaces estructuradas, que permiten identificar sesiones y resultados sin interpretar los colores, menús y pantallas de una TUI:

| Cliente | Interfaz nativa para el puente | Estado local observado |
| --- | --- | --- |
| Codex | `codex exec` para tareas acotadas; `codex app-server` para conversación persistente y eventos | CLI 0.165.0 instalada; sesión iniciada con ChatGPT |
| Copilot | `copilot -p --model auto` para tareas; `copilot --acp` para sesión persistente | CLI 1.0.105 instalada; elegibilidad de Student declarada por el usuario |
| OpenCode | `opencode run` para tareas; `opencode serve` / API de sesiones para conversación persistente | CLI 1.14.41 instalada; el perfil V2 requiere instalación separada |

Dejar el proceso abierto **no es un requisito** para continuar la misma conversación cuando el cliente guarda un ID de sesión y permite reanudarla. Si se quiere ver cada agente en una ventana propia, el controlador puede abrir una terminal de seguimiento para sus logs, mientras intercambia mensajes con los protocolos oficiales. Esto evita enviar teclas a una pantalla interactiva y confundir un prompt de aprobación con la respuesta del agente.

## Estado implementado en Kurapika

La aplicación Electron de este fork ya despacha tareas a `codex exec`, `copilot -p --model auto` y `opencode run`, conserva los IDs de sesión devueltos por cada cliente, transmite la salida a su ventana y permite detener o reiniciar una sesión. Un resultado puede copiarse al borrador de una tarea para otro cliente. Antigravity tiene un buzón manual. Las tareas de solo lectura pueden coexistir; el motor admite una sola edición activa en el proyecto. El estado y los logs quedan en el directorio de datos de la aplicación, separados por proyecto. La ventana y el motor se comunican por IPC local, sin servidor HTTP.

Esta primera implementación usa **un proceso por turno**. No proporciona una PTY interactiva ni asignación automática de roles: el usuario elige cliente y alcance. Tampoco verifica todavía la autenticación ni ejecuta una tarea real contra los planes del usuario desde este entorno. Las pruebas incluidas usan clientes falsos para comprobar el despacho y la API.

## Contrato de intercambio futuro

Cada tarea lleva `id`, objetivo, archivos permitidos, dependencias, criterio de aceptación, cliente elegido y permiso `solo_lectura` o `edicion`. El controlador conserva el ID de sesión del cliente, eventos y respuesta final en un directorio local ignorado por Git. Una respuesta puede originar una nueva tarea dirigida a otro cliente; el controlador entrega **solo el resumen y los archivos necesarios**, no credenciales ni toda la transcripción. Los agentes no comparten directamente sus sesiones autenticadas.

Para permitir ediciones simultáneas, cada cliente tendría que trabajar en archivos no superpuestos o en un worktree propio. El controlador integraría y verificaría el resultado antes de abrir otra tarea de edición sobre la misma zona. Las operaciones externas o irreversibles requieren controles adicionales antes de automatizarlas.

## Límite de Antigravity Student

La [FAQ oficial de Google](https://antigravity.google/docs/faq/) dice que `agy -p` está destinado a scripts directos y CI, pero **envolver `agy` en agentes o aplicaciones de terceros no está soportado bajo planes de consumidor**; usar software externo para acceder a la sesión de Antigravity viola sus términos. Dejar una terminal de `agy` abierta y que el controlador le escriba automáticamente sigue siendo esa clase de integración. El puente, por tanto, prepara una tarea para que la persona la ejecute directamente en Antigravity y luego incorpore manualmente el resultado. Un acceso separado mediante una clave de Google AI Studio o Gemini Enterprise tendría condiciones y cuotas distintas; no reutiliza el plan Student de Antigravity.

## Próximas etapas

1. Probar autenticación y una ejecución pequeña en cada CLI; no inferir acceso a partir de un modelo listado.
2. Incorporar roles y decisiones de delegación del proyecto original como flujos explícitos, con verificación de resultados y registro de costes o cuotas.
3. Incorporar los protocolos persistentes `codex app-server`, Copilot ACP y la API de OpenCode para aprobar herramientas y enviar mensajes durante una ejecución.
4. Añadir timeouts y aislamiento por worktree antes de permitir ediciones simultáneas; si se contrata una API de Gemini admitida, crear un adaptador distinto para ella.

Fuentes: [Codex como plataforma](https://developers.openai.com/blog/codex-as-a-platform), [Copilot CLI programático](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically), [Copilot ACP](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server), [Copilot Auto](https://docs.github.com/en/copilot/concepts/models/auto-model-selection), [OpenCode CLI](https://opencode.ai/v2/docs/cli/commands), [OpenCode API](https://opencode.ai/v2/docs/api), [Antigravity FAQ](https://antigravity.google/docs/faq/).
