"""Contextual chunking via Docling HybridChunker + per-chunk metadata extraction."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from ..utils.logger import get_logger
from ..utils.model_registry import tokenizer_id_for

log = get_logger(__name__)


@dataclass
class ChunkData:
    content: str
    page_range: list[int] | None = None
    heading_hierarchy: list[str] = field(default_factory=list)
    token_count: int = 0


def _load_tokenizer(model: str):
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(tokenizer_id_for(model))


def _extract_page_range(chunk) -> list[int] | None:
    pages: set[int] = set()
    try:
        for item in getattr(getattr(chunk, "meta", None), "doc_items", None) or []:
            for prov in getattr(item, "prov", None) or []:
                page_no = getattr(prov, "page_no", None)
                if page_no:
                    pages.add(int(page_no))
    except Exception:  # pragma: no cover - metadata shape drift across docling versions
        return None
    return sorted(pages) or None


def _extract_headings(chunk) -> list[str]:
    meta = getattr(chunk, "meta", None)
    headings = getattr(meta, "headings", None)
    if headings:
        out = [str(h) for h in headings if h]
        if out:
            return out
    # Fallback: derive from doc item labels
    labels: list[str] = []
    try:
        for item in getattr(meta, "doc_items", None) or []:
            label = str(getattr(item, "label", "") or "")
            if label and label not in labels:
                labels.append(label)
    except Exception:  # pragma: no cover
        pass
    return labels


def _chunk_sync(dl_doc, tokenizer, max_tokens: int):
    from docling.chunking import HybridChunker

    chunker = HybridChunker(
        tokenizer=tokenizer,
        max_tokens=max_tokens,
        merge_peers=True,
    )
    chunks = list(chunker.chunk(dl_doc))

    data: list[ChunkData] = []
    for chunk in chunks:
        text = chunk.text if hasattr(chunk, "text") else str(chunk)
        try:
            token_count = len(tokenizer.encode(text))
        except Exception:  # pragma: no cover - some fast tokenizers need add_special_tokens kw
            token_count = len(tokenizer.encode(text, add_special_tokens=False))
        data.append(
            ChunkData(
                content=text,
                page_range=_extract_page_range(chunk),
                heading_hierarchy=_extract_headings(chunk),
                token_count=token_count,
            )
        )
    return data


async def chunk_document(dl_doc, embedding_model: str, max_tokens: int = 512) -> list[ChunkData]:
    """Chunk a Docling document with the tokenizer matching the embedding model."""
    log.info("chunker.start", model=embedding_model, max_tokens=max_tokens)

    def run():
        tokenizer = _load_tokenizer(embedding_model)
        return _chunk_sync(dl_doc, tokenizer, max_tokens)

    result = await asyncio.to_thread(run)
    log.info("chunker.done", model=embedding_model, chunks=len(result))
    return result
