# Production image — CPU-only torch, no CUDA binaries
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    torch && \
    pip install --no-cache-dir -r requirements.txt

COPY ./app ./app

# Non-root runtime; model cache lives in the user's home (mounted as a volume)
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app /home/appuser
USER appuser
ENV HOME=/home/appuser

EXPOSE 8000

# WEB_CONCURRENCY=1 is recommended for small hosts: each worker keeps its own
# copy of loaded SentenceTransformers models in memory.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2}"]
