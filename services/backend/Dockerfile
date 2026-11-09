# The Meeting Copilot backend as a container (Render, Fly.io, Railway, any Docker host).
# Build from the repo root: docker build -f services/backend/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN pip install --no-cache-dir uv==0.13.7

WORKDIR /srv/services/backend
# Dependencies first so code changes rebuild fast.
COPY services/backend/pyproject.toml services/backend/uv.lock ./
# The `embeddings` extra runs search's embedding model (bge-small, 384 dims) in the container.
RUN uv sync --frozen --no-dev --no-install-project --extra embeddings
# Bake the model in so the server never downloads it at runtime (and starts fast after sleeping).
# PREFETCH_EMBEDDING_MODEL=0 skips it (build machines without Hugging Face access); search then
# downloads it on first use, or runs on keywords alone if it can't.
ARG PREFETCH_EMBEDDING_MODEL=1
ENV FASTEMBED_CACHE_PATH=/srv/models
RUN mkdir -p /srv/models && if [ "$PREFETCH_EMBEDDING_MODEL" = "1" ]; then \
      .venv/bin/python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"; \
    fi
COPY config /srv/config
COPY services/backend/app ./app

# Unprivileged user; uploaded project documents go to a writable folder.
RUN useradd --create-home copilot && mkdir -p /srv/data/documents && chown -R copilot /srv/data /srv/models
USER copilot
ENV DOCUMENTS_DIR=/srv/data/documents PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)"
CMD ["sh", "-c", "exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
