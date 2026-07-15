"""Claude Code CLI setup & health (JSON; the login PTY WS stays in app.web)."""
from __future__ import annotations

from pydantic import BaseModel

from fastapi import APIRouter

from app.services.analyzers.base import AnalyzerError
from app.services.analyzers.claude_cli import (
    ClaudeCliAnalyzer,
    cli_version,
    is_authenticated,
    save_oauth_token,
)

router = APIRouter()

_TEST_PROMPT = 'Reply with ONLY this JSON and nothing else: {"ok": true}'


class ClaudeStatusOut(BaseModel):
    version: str | None
    authed: bool


class ClaudeTestOut(BaseModel):
    ok: bool
    model: str | None = None
    error: str | None = None


class ClaudeTokenIn(BaseModel):
    token: str


class ClaudeTokenOut(BaseModel):
    ok: bool
    error: str | None = None
    authed: bool = False


@router.get("/provider/claude/status", response_model=ClaudeStatusOut)
def status():
    return ClaudeStatusOut(version=cli_version(), authed=is_authenticated())


@router.post("/provider/claude/test", response_model=ClaudeTestOut)
def test():
    """Run a trivial prompt through the CLI and report the outcome."""
    try:
        out = ClaudeCliAnalyzer().analyze(_TEST_PROMPT)
        return ClaudeTestOut(ok=True, model=out.model)
    except AnalyzerError as exc:
        return ClaudeTestOut(ok=False, error=str(exc))
    except Exception as exc:  # noqa: BLE001 - surface anything to the UI
        return ClaudeTestOut(ok=False, error=str(exc))


@router.post("/provider/claude/token", response_model=ClaudeTokenOut)
def save_token(body: ClaudeTokenIn):
    """Store the long-lived token printed by `claude setup-token`.

    `setup-token` only prints the token (nothing is persisted for the CLI), so
    the user copies it from the terminal into this form; it's saved in the
    claude_config volume and injected as CLAUDE_CODE_OAUTH_TOKEN on each run.
    """
    # The terminal wraps long tokens across lines; drop all whitespace.
    cleaned = "".join(body.token.split())
    if not cleaned.startswith("sk-ant-"):
        return ClaudeTokenOut(
            ok=False,
            error="That doesn't look like a Claude token (should start with sk-ant-).",
            authed=is_authenticated(),
        )
    save_oauth_token(cleaned)
    return ClaudeTokenOut(ok=True, authed=is_authenticated())
