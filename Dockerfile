# syntax=docker/dockerfile:1
#
# Quake Atlas: one container serving the API and the built frontend on port 8000.
# Data is not baked into the image; on first start the entrypoint downloads the
# sample catalog into /data (mount a volume there to keep it between runs).

# ---- 1. Build the frontend -----------------------------------------------------------
FROM node:24-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Runtime: Python API + static frontend ----------------------------------------
FROM python:3.12-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/backend/.venv \
    PYTHONUNBUFFERED=1

WORKDIR /app/backend
# Dependencies first so code changes don't invalidate this layer.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev

COPY --from=web /app/frontend/dist /app/frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && useradd --create-home --uid 10001 quakes \
    && mkdir -p /data \
    && chown -R quakes:quakes /data

ENV PATH="/app/backend/.venv/bin:$PATH" \
    QUAKES_DATA_DIR=/data \
    QUAKES_FRONTEND_DIST=/app/frontend/dist \
    PORT=8000

USER quakes
VOLUME ["/data"]
EXPOSE 8000

# The server starts only after the first-run download finishes, so allow time for it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/meta', timeout=4)"

LABEL org.opencontainers.image.title="Quake Atlas" \
      org.opencontainers.image.description="Interactive explorer and scenario simulator for historical earthquakes" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["entrypoint.sh"]
