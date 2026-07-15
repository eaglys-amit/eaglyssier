"""Provider-agnostic commit-analysis interface.

An Analyzer takes a fully-formed prompt (built by app.services.commit_analysis)
and returns structured JSON describing what a commit changed. Callers never
branch on the provider — they resolve one via app.services.analyzers.registry.
"""
from __future__ import annotations

from dataclasses import dataclass


class AnalyzerError(RuntimeError):
    """Raised for provider failures (bad exit, timeout, unparseable output)."""


@dataclass
class AnalyzerResult:
    data: dict  # parsed structured analysis (summary / changes / categories / files)
    model: str | None = None
    raw: str | None = None  # raw text response, kept for debugging


class Analyzer:
    provider: str

    def analyze(self, prompt: str) -> AnalyzerResult:  # pragma: no cover - interface
        raise NotImplementedError
