"""Mock OpenAI-compatible provider used to smoke-test the Custom provider flow.

Endpoints:
  POST /v1/embeddings        -> fixed 128-dim vectors (varies slightly by input hash)
Run:  python mock_provider.py   (port 9999)
"""
import hashlib
import sys

sys.path.insert(0, ".")

import uvicorn
from fastapi import FastAPI, Request

app = FastAPI()
DIM = 128


def embed_one(text: str):
    h = hashlib.sha256(text.encode()).digest()
    vec = []
    for i in range(DIM):
        byte = h[i % len(h)]
        val = ((byte / 255.0) - 0.5) * 2.0
        vec.append(round(val, 7))
    # normalize-ish so cosine behaves
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [round(v / norm, 7) for v in vec]


@app.post("/v1/embeddings")
async def embeddings(req: Request):
    body = await req.json()
    inputs = body.get("input", [])
    if isinstance(inputs, str):
        inputs = [inputs]
    data = [{"index": i, "object": "embedding", "embedding": embed_one(str(t))} for i, t in enumerate(inputs)]
    return {
        "object": "list",
        "model": body.get("model", "mock"),
        "data": data,
        "usage": {"prompt_tokens": 1, "total_tokens": 1},
    }


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": "test/mock-embed-128", "object": "model"}]}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9999, log_level="warning")
