# The Meeting Copilot backend as a container (Render, Fly.io, Railway, any Docker host).
# Build from the repo root: docker build -f services/backend/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN pip install --no-cache-dir uv==0.13.7

WORKDIR /srv/services/backend
# Dependencies first so code changes rebuild fast.
COPY services/backend/pyproject.toml services/backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY config /srv/config
COPY services/backend/app ./app

# Unprivileged user; uploaded project documents go to a writable folder.
RUN useradd --create-home copilot && mkdir -p /srv/data/documents && chown -R copilot /srv/data
USER copilot
ENV DOCUMENTS_DIR=/srv/data/documents PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)"
CMD ["sh", "-c", "exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
