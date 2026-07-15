"""Per-project interactive Claude CLI terminal (PTY bridged to xterm.js).

The SPA's Terminal tab opens a WebSocket to ``/projects/{id}/terminal/ws``,
which spawns an interactive `claude` session in a PTY whose cwd is a
project-scoped scratch dir (see :mod:`app.services.terminal_context`). Claude
reads the generated ``CLAUDE.md`` and can query the project's live Postgres
data. Modeled on the setup-token terminal in
:mod:`app.web.routes.provider_ws`, with terminal-resize support added.
"""
from __future__ import annotations

import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.db import get_db
from app.models import Project
from app.services.analyzers.claude_cli import ensure_onboarding_complete, oauth_token
from app.services.terminal_context import prepare_workdir

router = APIRouter()

# App secrets kept out of the terminal subprocess so it can only reach the DB
# through the read-only role in CLAUDE.md, not the owner credentials.
_SENSITIVE_ENV = {
    "DATABASE_URL",
    "SECRET_KEY",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_ENDPOINT_URL",
    "S3_BUCKET",
    "S3_REGION",
}


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


@router.websocket("/projects/{project_id}/terminal/ws")
async def terminal_ws(ws: WebSocket, project_id: int):
    """Run an interactive `claude` session in a PTY and bridge it to xterm.js.

    Binary WS frames are treated as keystrokes (written to the PTY); text frames
    are JSON control messages (currently only ``{"resize": {"cols", "rows"}}``).
    """
    await ws.accept()

    # Look up the project and build its scratch workdir before opening the PTY.
    db = next(get_db())
    try:
        project = db.get(Project, project_id)
        if project is None:
            await ws.close(code=4404)
            return
        workdir = prepare_workdir(project, db)
    finally:
        db.close()

    # Skip the CLI's first-run onboarding (theme + login screens) — the saved
    # OAuth token is the session; onboarding would ask to "log in" regardless.
    ensure_onboarding_complete()

    master, slave = pty.openpty()
    _set_winsize(slave, 30, 100)

    # No --dangerously-skip-permissions: the container runs as root and the CLI
    # refuses that flag under root. Instead, prepare_workdir() writes a
    # .claude/settings.json that pre-approves only the read-only DB query path;
    # anything else prompts in the terminal for the user to approve.
    #
    # Strip the app's privileged secrets from the child env so the session can
    # only reach the database through the least-privilege read-only role handed
    # to it in CLAUDE.md — never the owner credentials in DATABASE_URL.
    child_env = {
        k: v for k, v in os.environ.items() if k not in _SENSITIVE_ENV
    }
    child_env["HOME"] = os.environ.get("HOME", "/root")
    child_env["TERM"] = "xterm-256color"
    # Same auth as the analyzer: the long-lived OAuth token saved from the
    # Provider tab (or a non-empty CLAUDE_CODE_OAUTH_TOKEN in the env, which
    # wins inside oauth_token()). Assign unconditionally — compose may have set
    # the var to "" via `${CLAUDE_CODE_OAUTH_TOKEN:-}`.
    token = oauth_token()
    if token:
        child_env["CLAUDE_CODE_OAUTH_TOKEN"] = token
    proc = subprocess.Popen(
        [settings.claude_bin],
        stdin=slave, stdout=slave, stderr=slave,
        cwd=workdir,
        env=child_env,
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
            if data is not None:
                try:
                    os.write(master, data)
                except OSError:
                    break
                continue
            text = msg.get("text")
            if text is not None:
                try:
                    ctrl = json.loads(text)
                except (ValueError, TypeError):
                    continue
                if ctrl.get("resize"):
                    r = ctrl["resize"]
                    _set_winsize(master, int(r.get("rows", 30)), int(r.get("cols", 100)))
    except WebSocketDisconnect:
        pass
    finally:
        reader.cancel()
        # claude spawns a process tree and the Ink TUI doesn't always exit on a
        # bare SIGTERM, so signal the whole session group and escalate to SIGKILL.
        try:
            pgid = os.getpgid(proc.pid)
        except ProcessLookupError:
            pgid = None
        if pgid is not None:
            try:
                os.killpg(pgid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.sleep(1.0)
            except asyncio.CancelledError:
                pass
            if proc.poll() is None:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        try:
            os.close(master)
        except OSError:
            pass
