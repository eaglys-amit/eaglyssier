# ---- Frontend build (React SPA served by FastAPI from frontend/dist) --------
FROM node:20-slim AS spa
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Runtime -----------------------------------------------------------------
FROM python:3.12-slim

# WeasyPrint runtime dependencies (Pango / Cairo / GDK-Pixbuf stack) + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi-dev \
        shared-mime-info \
        fonts-dejavu-core \
        curl \
        postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 + Claude Code CLI (used by the "claude_cli" commit-analysis provider).
# The CLI reads its OAuth login from $HOME/.claude, mounted as a named volume in compose.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local

WORKDIR /code

# Install dependencies first (cached layer). --system installs into the image's Python.
COPY pyproject.toml ./
RUN uv pip install --system -r pyproject.toml

COPY . .
# The built SPA (dist is .dockerignore'd, so this is the authoritative copy).
COPY --from=spa /frontend/dist ./frontend/dist

EXPOSE 8000

CMD ["./scripts/entrypoint.sh"]
