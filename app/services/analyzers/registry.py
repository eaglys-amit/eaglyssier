"""Analyzer registry — the single place providers are resolved.

Only "claude_cli" is implemented this iteration. The API-based providers are
listed so the UI can offer (and disable) them, but constructing one raises until
its module lands. Future providers take the project's decrypted `credentials`
and a `config` dict (e.g. model name).
"""
from __future__ import annotations

from app.services.analyzers.base import Analyzer
from app.services.analyzers.claude_cli import ClaudeCliAnalyzer

# provider key -> human label. Order defines the UI dropdown order.
PROVIDERS: dict[str, str] = {
    "claude_cli": "Claude Code CLI (local)",
    "anthropic": "Claude API",
    "openai": "OpenAI API",
    "gemini": "Gemini API",
}

# Implemented today; the rest are registered-but-inert slots.
_IMPLEMENTED = {"claude_cli"}


def is_available(provider: str) -> bool:
    return provider in _IMPLEMENTED


def get_analyzer(
    provider: str,
    *,
    credentials: str | None = None,
    config: dict | None = None,
) -> Analyzer:
    if provider == "claude_cli":
        return ClaudeCliAnalyzer(model=(config or {}).get("model"))
    if provider in PROVIDERS:
        raise NotImplementedError(
            f"Analysis provider '{PROVIDERS[provider]}' is not yet available."
        )
    raise NotImplementedError(f"Unknown analysis provider '{provider}'.")
