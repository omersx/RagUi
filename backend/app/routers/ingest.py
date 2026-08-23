"""POST /api/ingest — full ingestion pipeline orchestration."""
from __future__ import annotations

import time

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ..config import get_settings
from ..database import ensure_chunk_table, pool
from ..models.schemas import ChunkOut, ChatConfig
from ..services.chunker import chunk_document
from ..services.embedder import embed_texts
from ..services.file_manager import (
    find_duplicate,
    insert_file_record,
    sha256_bytes,
    update_file_status,
)
from ..services.parser import parse_document
from ..services.retriever import resolve_embedding_dimensions, to_pg_vector
from ..utils.logger import get_logger
from ..utils.model_registry import get_chunk_table_name, validate_local_model

router = APIRouter()
log = get_logger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".html", ".htm", ".pptx", ".md"}
MIME_PREFIXES = ("application/pdf", "text/", "application/msword",
                 "application/vnd.openxmlformats-officedocument",
                 "application/vnd.ms-powerpoint")


@router.post("/ingest")
async def ingest(
    file: UploadFile = File(...),
    embedding_provider: str = Form("local"),
    embedding_model: str = Form("all-MiniLM-L6-v2"),
    embedding_base_url: str = Form(""),
    embedding_dimensions: int = Form(0),
    api_key: str = Form(""),
    ocr_enabled: bool = Form(False),
    max_tokens: int = Form(512),
):
    settings = get_settings()
    started = time.perf_counter()

    # --- Validation (extension + MIME + size) ---
    filename = file.filename or "unnamed"
    ext = ".".join(filename.lower().split(".")[-1:]) if "." in filename else ""
    if f".{ext}" not in ALLOWED_EXTENSIONS:
        return JSONResponse(
            status_code=422,
            content={"detail": f"Unsupported file type: .{ext}. Allowed: PDF, DOCX, HTML, PPTX, MD"},
        )

    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    # Reject oversized uploads before buffering them into memory (DoS guard).
    declared_size = getattr(file, "size", None)
    if declared_size is not None and declared_size > max_bytes:
        return JSONResponse(
            status_code=422,
            content={"detail": f"File exceeds {settings.max_upload_size_mb}MB limit."},
        )
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        return JSONResponse(
            status_code=422,
            content={"detail": f"File exceeds {settings.max_upload_size_mb}MB limit."},
        )

    # Local models must be whitelisted; custom API model names just need to be SQL-safe
    if embedding_provider == "local":
        try:
            validate_local_model(embedding_model)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    try:
        get_chunk_table_name(embedding_model)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # --- Deduplication ---
    file_hash = sha256_bytes(data)
    existing_id = await find_duplicate(file_hash)
    if existing_id is not None:
        return JSONResponse(
            status_code=409,
            content={
                "status": "duplicate",
                "message": "File already ingested.",
                "existing_file_id": existing_id,
            },
        )

    mime_type = file.content_type if file.content_type else None

    file_id = await insert_file_record(filename, file_hash, len(data), mime_type, embedding_model)
    log.info("ingest.start", file_id=file_id, filename=filename, bytes=len(data), model=embedding_model)

    config = ChatConfig(
        embedding_provider="api" if embedding_provider == "api" else (
            "custom" if embedding_provider == "custom" else "local"
        ),
        embedding_model=embedding_model,
        embedding_base_url=embedding_base_url or "",
        embedding_dimensions=int(embedding_dimensions or 0),
        api_key=api_key,
    )

    try:
        parsed = await parse_document(data, filename, ocr_enabled)
        chunks = await chunk_document(parsed.document, embedding_model, max_tokens)

        vectors: list[list[float]] = []
        if chunks:
            vectors = await embed_texts([c.content for c in chunks], config)

        dims = await resolve_embedding_dimensions(config)
        table = await ensure_chunk_table(embedding_model, dimensions=dims)
        if chunks:
            records = [
                (
                    c.content,
                    file_id,
                    c.page_range or [],
                    c.heading_hierarchy,
                    c.token_count,
                    to_pg_vector(v),
                )
                for c, v in zip(chunks, vectors)
            ]
            async with pool().acquire() as conn:
                await conn.executemany(
                    f"""
                    INSERT INTO {table}
                        (content, source_file_id, page_range, heading_hierarchy, token_count, embedding)
                    VALUES ($1, $2, $3, $4, $5, $6::vector)
                    """,
                    records,
                )

        await update_file_status(file_id, "completed", parsed.raw_markdown, len(chunks))
        elapsed = round(time.perf_counter() - started, 2)
        log.info("ingest.completed", file_id=file_id, chunks=len(chunks), seconds=elapsed)

        return {
            "status": "success",
            "file_id": file_id,
            "filename": filename,
            "raw_markdown": parsed.raw_markdown,
            "chunks": [ChunkOut(id=i, **vars(c)).model_dump(exclude={"similarity"}) for i, c in enumerate(chunks, start=1)],
            "total_chunks": len(chunks),
            "embedding_model": embedding_model,
            "processing_time_seconds": elapsed,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await update_file_status(file_id, "failed", error_message=str(exc)[:1000])
        log.error("ingest.failed", file_id=file_id, error=str(exc), exc_info=True)
        # Never leak internal details (paths, driver errors) to the client.
        raise HTTPException(status_code=500, detail="Ingestion failed — check server logs.")
