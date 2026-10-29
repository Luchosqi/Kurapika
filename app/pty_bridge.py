#!/usr/bin/env python3
"""Small Linux PTY bridge. Protocol: one JSON object per line on stdin/stdout."""

import base64
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import sys
import termios


def command(provider, mode):
    if mode not in ("inspect", "edit"):
        raise ValueError("Modo desconocido")
    if provider == "codex":
        return ["codex", "-s", "read-only" if mode == "inspect" else "workspace-write", "-a", "on-request", "--no-alt-screen"]
    if provider == "copilot":
        args = ["copilot", "--model", "auto", "--no-color"]
        if mode == "inspect":
            args += ["--available-tools", "view,glob,grep"]
        return args
    if provider == "opencode":
        return ["opencode", "--agent", "plan" if mode == "inspect" else "build"]
    raise ValueError("Esta CLI no admite terminal integrada")


def emit(kind, **fields):
    sys.stdout.write(json.dumps({"type": kind, **fields}, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    if sys.platform != "linux":
        raise RuntimeError("La PTY integrada requiere Linux")
    argv = command(sys.argv[1], sys.argv[2])
    cols, rows = int(sys.argv[3]), int(sys.argv[4])
    if not (20 <= cols <= 300 and 8 <= rows <= 100):
        raise ValueError("Tamaño de terminal inválido")
    pid, master = pty.fork()
    if pid == 0:
        env = dict(os.environ, TERM="xterm-256color", COLUMNS=str(cols), LINES=str(rows))
        try:
            os.execvpe(argv[0], argv, env)
        except OSError as exc:
            os.write(2, f"No se pudo iniciar {argv[0]}: {exc}\r\n".encode())
            os._exit(127)
    size(master, cols, rows)
    selector = selectors.DefaultSelector()
    selector.register(master, selectors.EVENT_READ, "pty")
    selector.register(sys.stdin.buffer, selectors.EVENT_READ, "control")
    emit("ready", pid=pid)
    buffer = bytearray()
    child_status = None
    try:
        while True:
            for key, _ in selector.select(timeout=0.1):
                if key.data == "pty":
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        chunk = b""
                    if chunk:
                        emit("output", data=base64.b64encode(chunk).decode("ascii"))
                    else:
                        selector.unregister(master)
                else:
                    chunk = os.read(sys.stdin.fileno(), 65536)
                    if not chunk:
                        os.killpg(pid, signal.SIGTERM)
                        selector.unregister(sys.stdin.buffer)
                        continue
                    buffer.extend(chunk)
                    if len(buffer) > 131072:
                        raise ValueError("Mensaje de control demasiado largo")
                    while b"\n" in buffer:
                        raw, _, rest = buffer.partition(b"\n")
                        buffer = bytearray(rest)
                        message = json.loads(raw)
                        kind = message.get("type")
                        if kind == "input":
                            data = base64.b64decode(message["data"], validate=True)
                            if len(data) > 16384:
                                raise ValueError("Entrada demasiado larga")
                            os.write(master, data)
                        elif kind == "resize":
                            new_cols, new_rows = message["cols"], message["rows"]
                            if not (isinstance(new_cols, int) and 20 <= new_cols <= 300 and isinstance(new_rows, int) and 8 <= new_rows <= 100):
                                raise ValueError("Tamaño inválido")
                            size(master, new_cols, new_rows)
                            os.killpg(pid, signal.SIGWINCH)
                        elif kind == "signal" and message.get("name") in ("SIGINT", "SIGTERM"):
                            os.killpg(pid, getattr(signal, message["name"]))
            if child_status is None:
                ended, status = os.waitpid(pid, os.WNOHANG)
                if ended:
                    child_status = os.waitstatus_to_exitcode(status)
            if child_status is not None and not selector.get_map().get(master):
                emit("exit", code=child_status)
                return
    finally:
        if child_status is None:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        os.close(master)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        sys.exit(1)
