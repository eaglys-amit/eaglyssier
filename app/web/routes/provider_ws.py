"""Claude CLI login terminal: `claude setup-token` in a PTY over WebSocket.

The JSON status/test/token endpoints live in app.api.routes.provider; this WS
keeps its original non-/api path (the SPA's xterm client connects here).
"""
from __future__ import annotations

import asyncio
import fcntl
import os
import pty
import signal
import struct
import subprocess
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.services.analyzers.claude_cli import ensure_onboarding_complete

router = APIRouter()


@router.websocket("/provider/claude/login/ws")
async def login_ws(ws: WebSocket):
    """Run `claude setup-token` in a PTY and bridge it to a browser terminal.

    The CLI prints an OAuth URL; the user authorizes in their browser and pastes
    the code back into the terminal, which we forward to the process's stdin.
    """
    await ws.accept()
    ensure_onboarding_complete()  # setup-token shouldn't detour through first-run onboarding
    master, slave = pty.openpty()
    # Give the PTY a fixed size so the Ink UI renders predictably; the client's
    # xterm is configured to match (100x30).
    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    except OSError:
        pass

    proc = subprocess.Popen(
        [settings.claude_bin, "setup-token"],
        stdin=slave, stdout=slave, stderr=slave,
        env={**os.environ, "HOME": os.environ.get("HOME", "/root"), "TERM": "xterm-256color"},
        start_new_session=True,
        close_fds=True,
    )
    os.close(slave)
    loop = asyncio.get_running_loop()

    def _read() -> bytes:
        try:
            return os.read(master, 4096)
        except OSError:
            return b""

    async def pump_output() -> None:
        try:
            while True:
                data = await loop.run_in_executor(None, _read)
                if not data:
                    break
                await ws.send_bytes(data)
        except Exception:  # noqa: BLE001 - client gone / fd closed
            pass

    reader = asyncio.create_task(pump_output())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data is None and msg.get("text") is not None:
                data = msg["text"].encode()
            if data:
                try:
                    os.write(master, data)
                except OSError:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        reader.cancel()
        try:
            proc.send_signal(signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.close(master)
        except OSError:
            pass
