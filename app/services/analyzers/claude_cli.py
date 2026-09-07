"""Claude Code CLI analyzer.

Shells out to the locally-installed `claude` binary in headless print mode
(`claude -p --output-format json`) with the prompt on stdin. Auth is a
long-lived OAuth token from `claude setup-token` — supplied either via the
CLAUDE_CODE_OAUTH_TOKEN env var or pasted into the Provider tab (persisted in
$HOME/.claude, the claude_config volume). No API key required.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile

from app.config import settings
from app.services.analyzers.base import Analyzer, AnalyzerError, AnalyzerResult


def cli_version() -> str | None:
    """The installed `claude` version string, or None if the binary is missing."""
    try:
        proc = subprocess.run(
            [settings.claude_bin, "--version"],
            capture_output=True, text=True, timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    return proc.stdout.strip() if proc.returncode == 0 else None


def _token_path() -> str:
    home = os.environ.get("HOME") or "/root"
    return os.path.join(home, ".claude", "cli_oauth_token")


def oauth_token() -> str | None:
    """Long-lived OAuth token: CLAUDE_CODE_OAUTH_TOKEN env var, else the one
    saved from the Provider tab in the claude_config volume."""
    token = (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or "").strip()
    if token:
        return token
    try:
        with open(_token_path(), encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        return None
    return token or None


def save_oauth_token(token: str) -> None:
    """Persist a `claude setup-token` token in the claude_config volume."""
    path = _token_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(token.strip() + "\n")


def _config_json_path() -> str:
    """Where the CLI keeps its state file (.claude.json).

    With CLAUDE_CONFIG_DIR set (compose points it at the claude_config volume)
    the file lives inside that dir and persists across container recreates;
    otherwise it's $HOME/.claude.json.
    """
    cfg_dir = (os.environ.get("CLAUDE_CONFIG_DIR") or "").strip()
    if cfg_dir:
        return os.path.join(cfg_dir, ".claude.json")
    home = os.environ.get("HOME") or "/root"
    return os.path.join(home, ".claude.json")


def ensure_onboarding_complete() -> None:
    """Pre-seed the CLI's first-run onboarding so PTY sessions skip it.

    Interactive `claude` demands theme selection and a login-method choice on
    first boot even when CLAUDE_CODE_OAUTH_TOKEN is set. That state lives in
    .claude.json, which (without CLAUDE_CONFIG_DIR) sits outside the
    claude_config volume and is lost on every container recreate — the
    terminal then appears to ask for a fresh login despite the saved token.
    Merge the flags in (never clobber existing state) before spawning.
    """
    path = _config_json_path()
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    if cfg.get("hasCompletedOnboarding") and cfg.get("theme"):
        return
    cfg.setdefault("hasCompletedOnboarding", True)
    cfg.setdefault("theme", "dark")  # the SPA terminal renders on a dark background
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, path)


def is_authenticated() -> bool:
    """True if an OAuth token or an interactive login is available to the CLI."""
    if oauth_token():
        return True
    # Interactive `/login` credentials (if someone authenticated the CLI directly).
    home = os.environ.get("HOME") or "/root"
    cred = os.path.join(home, ".claude", ".credentials.json")
    try:
        return os.path.getsize(cred) > 0
    except OSError:
        return False


def _strip_code_fences(text: str) -> str:
    """Drop a leading ```json / ``` fence and trailing ``` if the model added one."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        if t.rstrip().endswith("```"):
            t = t.rstrip()[: -3]
    return t.strip()


class ClaudeCliAnalyzer(Analyzer):
    provider = "claude_cli"

    def __init__(self, model: str | None = None, timeout: int | None = None):
        # Per-call model override (e.g. "opus"/"sonnet"/"haiku"); falls back to
        # the CLAUDE_MODEL env default, then the CLI's own default.
        self.model = model or settings.claude_model
        # Per-call timeout, because generation lengths differ by an order of
        # magnitude: a commit analysis is a paragraph, a repository document is
        # ~1200 words and routinely outruns claude_timeout_seconds. Callers that
        # pass nothing keep the global default exactly as before.
        self.timeout = timeout or settings.claude_timeout_seconds

    def analyze(self, prompt: str) -> AnalyzerResult:
        cmd = [settings.claude_bin, "-p", "--output-format", "json"]
        if self.model:
            cmd += ["--model", self.model]

        env = dict(os.environ)
        env.setdefault("HOME", "/root")  # so the CLI finds /root/.claude
        # oauth_token() already prefers a non-empty env var over the saved file,
        # so assign unconditionally — compose may have set the var to "" (via
        # `${CLAUDE_CODE_OAUTH_TOKEN:-}`), which setdefault would keep.
        token = oauth_token()
        if token:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = token

        # Run in a throwaway cwd so Claude doesn't scan the mounted project tree.
        with tempfile.TemporaryDirectory() as workdir:
            try:
                proc = subprocess.run(
                    cmd,
                    input=prompt,
                    capture_output=True,
                    text=True,
                    cwd=workdir,
                    env=env,
                    timeout=self.timeout,
                )
            except subprocess.TimeoutExpired as exc:
                raise AnalyzerError(
                    f"Claude CLI timed out after {self.timeout}s"
                ) from exc
            except FileNotFoundError as exc:
                raise AnalyzerError(
                    f"Claude CLI binary '{settings.claude_bin}' not found in the image"
                ) from exc

        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "").strip()[-500:]
            raise AnalyzerError(f"Claude CLI exited {proc.returncode}: {tail}")

        # The CLI wraps the assistant reply in a JSON envelope; result text is `result`.
        try:
            envelope = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise AnalyzerError(
                f"Could not parse Claude CLI envelope: {proc.stdout[:300]}"
            ) from exc

        if isinstance(envelope, dict) and envelope.get("is_error"):
            raise AnalyzerError(f"Claude CLI reported an error: {envelope.get('result')}")

        result_text = envelope.get("result") if isinstance(envelope, dict) else None
        # The CLI reports the model(s) used under `modelUsage` (keyed by model id),
        # not a top-level `model` field. Several models can appear (a small model
        # handles background tasks), so report the one that did the most work —
        # the highest output-token count — which is the model that answered.
        model = envelope.get("model") if isinstance(envelope, dict) else None
        if not model and isinstance(envelope, dict):
            usage = envelope.get("modelUsage")
            if isinstance(usage, dict) and usage:
                def _out_tokens(item: object) -> int:
                    if not isinstance(item, dict):
                        return 0
                    return int(item.get("outputTokens") or item.get("output_tokens") or 0)

                model = max(usage, key=lambda k: _out_tokens(usage[k]))
        if not result_text:
            raise AnalyzerError("Claude CLI returned an empty result")

        try:
            data = json.loads(_strip_code_fences(result_text))
        except json.JSONDecodeError as exc:
            raise AnalyzerError(
                f"Model did not return valid JSON: {result_text[:300]}"
            ) from exc

        return AnalyzerResult(data=data, model=model, raw=result_text)
