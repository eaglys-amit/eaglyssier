"""Application settings loaded from environment (pydantic-settings)."""
from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://reports:reports@db:5432/reports"

    # RustFS / S3-compatible object storage
    s3_endpoint_url: str = "http://rustfs:9000"
    s3_access_key: str = "rustfsadmin"
    s3_secret_key: str = "rustfsadmin"
    s3_bucket: str = "reports"
    s3_region: str = "us-east-1"

    # Secret used to derive the Fernet key that encrypts stored integration credentials.
    secret_key: str = "change-me-32-byte-dev-secret-key!"

    run_scheduler: bool = True
    sync_interval_minutes: int = 60

    # Commit analysis (LLM providers). Only "claude_cli" is implemented; the
    # Anthropic/OpenAI/Gemini API providers are registered but deferred.
    default_analysis_provider: str = "claude_cli"
    claude_bin: str = "claude"
    claude_model: str | None = None  # optional --model override for the CLI
    claude_timeout_seconds: int = 180
    claude_max_diff_bytes: int = 60000  # cap on diff text sent to the model

    # Reference documents (see app.services.references). The byte cap is
    # enforced by a chunked read, not by Content-Length, which is client-supplied.
    reference_max_bytes: int = 10_000_000  # 10 MB per file
    reference_max_chars: int = 200_000  # cap on extracted text kept in the DB
    breakdown_max_prompt_chars: int = 60_000  # per-prompt document budget

    # Per-repo AI documentation sets (see app.services.repo_doc_gen). A document
    # is a far longer generation than a commit analysis, so it carries its own
    # timeout rather than borrowing claude_timeout_seconds above.
    repo_doc_max_prompt_chars: int = 60_000  # evidence budget per document
    repo_doc_target_words: int = 1_200
    repo_doc_max_chars: int = 200_000  # cap on one document's markdown
    repo_doc_timeout_seconds: int = 300

    @property
    def fernet_key(self) -> bytes:
        """Derive a stable urlsafe-base64 32-byte Fernet key from SECRET_KEY."""
        digest = hashlib.sha256(self.secret_key.encode()).digest()
        return base64.urlsafe_b64encode(digest)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
