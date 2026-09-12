"""Phase 3 — LLM entity/relation extraction (opt-in, background).

Pipeline: chunks -> batched LLM calls (JSON) -> canonicalized entities +
relations. Entity identity is (normalized name, type), global across files;
every mention keeps chunk-level provenance in entity_mentions.

Only `normalize_name`, `coerce_type`, and `parse_extraction_json` are pure —
everything else needs DB + LLM and is intentionally thin.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field

from ..database import pool
from ..models.schemas import ChatConfig
from ..utils.logger import get_logger
from .generator import generate_once

log = get_logger(__name__)

ENTITY_TYPES = ("person", "organization", "place", "concept", "event", "other")

MAX_CHUNKS_PER_FILE = 80
MAX_CHARS_PER_BATCH = 6000
MAX_BATCHES = 12
MAX_ITEMS_PER_BATCH = 50

EXTRACTION_PROMPT = """Extract the key entities and their relationships from the text below.
Return JSON ONLY, no other text, with this exact shape:
{"entities": [{"name": "...", "type": "person|organization|place|concept|event|other"}], "relations": [{"source": "<entity name>", "target": "<entity name>", "label": "<short verb phrase>", "confidence": 0.0-1.0}]}
Rules: at most 12 entities and 12 relations; relation endpoints MUST match entity names exactly; labels are 1-4 word verb phrases (e.g. "approved", "works at", "delayed"); skip trivial/generic entities.

Text:
\"\"\"{text}\"\"\""""


@dataclass
class ExtractedEntity:
    name: str
    type: str = "concept"


@dataclass
class ExtractedRelation:
    source: str
    target: str
    label: str
    confidence: float = 0.8


@dataclass
class BatchResult:
    entities: list[ExtractedEntity] = field(default_factory=list)
    relations: list[ExtractedRelation] = field(default_factory=list)


# ------------------------------------------------------------ pure ----


def normalize_name(name: str) -> str:
    """Canonical key for entity resolution: lowercase, articles + punctuation out."""
    s = name.strip().lower()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    s = re.sub(r"[^a-z0-9\s]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def coerce_type(raw: object) -> str:
    t = str(raw or "").strip().lower()
    return t if t in ENTITY_TYPES else "concept"


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    return t.strip()


def parse_extraction_json(text: str) -> BatchResult:
    """Parse one LLM batch reply. Never raises — junk yields an empty result."""
    out = BatchResult()
    try:
        clean = _strip_fences(text or "")
        start, end = clean.find("{"), clean.rfind("}")
        if start < 0 or end <= start:
            return out
        data = json.loads(clean[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return out
    if not isinstance(data, dict):
        return out

    for item in (data.get("entities") or [])[:MAX_ITEMS_PER_BATCH]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:200]
        if not name or not normalize_name(name):
            continue
        out.entities.append(ExtractedEntity(name=name, type=coerce_type(item.get("type"))))

    for item in (data.get("relations") or [])[:MAX_ITEMS_PER_BATCH]:
        if not isinstance(item, dict):
            continue
        src = str(item.get("source") or "").strip()[:200]
        dst = str(item.get("target") or "").strip()[:200]
        label = re.sub(r"\s+", " ", str(item.get("label") or "").strip().lower())[:100]
        if not src or not dst or not label:
            continue
        try:
            conf = float(item.get("confidence", 0.8))
        except (TypeError, ValueError):
            conf = 0.8
        out.relations.append(
            ExtractedRelation(source=src, target=dst, label=label, confidence=min(1.0, max(0.0, conf)))
        )
    return out


def batch_chunks(chunks: list[tuple[int, str]]) -> list[list[tuple[int, str]]]:
    """Group (chunk_id, text) into char-budgeted batches."""
    batches: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    size = 0
    for cid, text in chunks:
        t = text or ""
        if size + len(t) > MAX_CHARS_PER_BATCH and current:
            batches.append(current)
            current, size = [], 0
        current.append((cid, t))
        size += len(t)
    if current:
        batches.append(current)
    return batches[:MAX_BATCHES]


# ------------------------------------------------------------ worker ----

_in_progress: set[int] = set()
_in_progress_lock = asyncio.Lock()

# Concurrency cap for simultaneous extraction files (protects local-model RAM
# and API burst quotas). Recreated if the configured limit ever changes.
_sem: asyncio.Semaphore | None = None
_sem_limit: int | None = None


def _semaphore(limit: int | None = None) -> asyncio.Semaphore:
    from ..config import get_settings

    global _sem, _sem_limit
    lim = max(1, limit if limit is not None else get_settings().entity_max_concurrency)
    if _sem is None or _sem_limit != lim:
        _sem = asyncio.Semaphore(lim)
        _sem_limit = lim
    return _sem


async def _with_retries(label: str, fn, *, attempts: int, base_delay: float = 2.0, sleep=asyncio.sleep) -> str:
    """Run an LLM batch call with exponential backoff. Pure-testable via `sleep`.

    Empty output and exceptions both count as failure; "" after exhaustion
    means "skip this batch" to the caller — never raises.
    """
    attempts = max(1, attempts)
    for attempt in range(1, attempts + 1):
        try:
            result = await fn()
            if (result or "").strip():
                return result
            last = "empty output"
        except Exception as exc:  # transient transport/model errors -> retry
            last = str(exc)[:200]
        if attempt < attempts:
            delay = base_delay * (2 ** (attempt - 1))
            log.warning("entities.batch_retry", label=label, attempt=attempt, wait=delay, reason=last)
            await sleep(delay)
    log.warning("entities.batch_exhausted", label=label, attempts=attempts, reason=last)
    return ""


async def queue_depth() -> dict[str, int]:
    """Background-extraction backlog for /api/health. Never raises."""
    async with _in_progress_lock:
        running = len(_in_progress)
    try:
        async with pool().acquire() as conn:
            queued = await conn.fetchval("SELECT COUNT(*) FROM extraction_jobs WHERE status = 'queued'")
            processing = await conn.fetchval(
                "SELECT COUNT(*) FROM extraction_jobs WHERE status = 'processing'"
            )
    except Exception:
        queued = processing = 0
    return {"running": running, "queued": int(queued or 0), "processing": int(processing or 0)}


async def _resolve_or_create_entity(
    conn, name: str, etype: str, file_id: int, chunk_id: int
) -> int | None:
    """Return the canonical entity id, creating rows + mention as needed."""
    norm = normalize_name(name)
    if not norm:
        return None
    row = await conn.fetchrow(
        "SELECT id FROM entities WHERE normalized = $1 AND type = $2", norm, etype
    )
    if row is None:
        row = await conn.fetchrow(
            "INSERT INTO entities (name, normalized, type, mention_count) "
            "VALUES ($1, $2, $3, 1) RETURNING id",
            name.strip()[:255],
            norm,
            etype,
        )
    else:
        await conn.execute("UPDATE entities SET mention_count = mention_count + 1 WHERE id = $1", row["id"])
    await conn.execute(
        "INSERT INTO entity_mentions (entity_id, source_file_id, chunk_id) VALUES ($1, $2, $3)",
        row["id"],
        file_id,
        chunk_id,
    )
    return int(row["id"])


MAX_JOB_ATTEMPTS = 3

# Strong refs for fire-and-forget tasks (asyncio only weakly holds them).
_tasks: set[asyncio.Task] = set()


def _give_up(attempts: int) -> bool:
    """Job-level give-up: stop re-running a file that keeps crashing."""
    return attempts > MAX_JOB_ATTEMPTS


def job_params(llm_config: ChatConfig) -> dict[str, str]:
    """Persistable job params. SECURITY: api_key is NEVER included — recovery
    runs keyless (local models work; API providers must retry from the app)."""
    return {
        "llm_provider": llm_config.llm_provider,
        "llm_model": llm_config.llm_model,
        "llm_base_url": llm_config.llm_base_url or "",
    }


def spawn_extraction(coro) -> asyncio.Task:
    """Schedule background extraction with a strong ref so it can't be GC'd."""
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def enqueue_extraction(
    file_id: int, llm_config: ChatConfig, chunk_table: str | None = None
) -> bool:
    """Persist a job as queued (upsert) and start it. False = already running.

    The conditional upsert never clobbers a running job, so concurrent
    triggers across workers are safe.
    """
    params = job_params(llm_config)
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "INSERT INTO extraction_jobs (file_id, llm_provider, llm_model, llm_base_url, "
            "status, attempts, error) VALUES ($1, $2, $3, $4, 'queued', 0, NULL) "
            "ON CONFLICT (file_id) DO UPDATE SET llm_provider = $2, llm_model = $3, "
            "llm_base_url = $4, status = 'queued', attempts = 0, error = NULL, "
            "updated_at = CURRENT_TIMESTAMP "
            "WHERE extraction_jobs.status <> 'processing' RETURNING file_id",
            file_id,
            params["llm_provider"],
            params["llm_model"],
            params["llm_base_url"],
        )
    if row is None:
        return False
    spawn_extraction(run_entity_extraction(file_id, llm_config, chunk_table))
    return True


async def recover_extraction_jobs(limit: int = 50) -> int:
    """Boot recovery: orphaned 'processing' jobs died with their process.

    Reset them to queued and restart them (keyless — see job_params).
    Called once from app lifespan after init_db.
    """
    async with pool().acquire() as conn:
        await conn.execute(
            "UPDATE extraction_jobs SET status = 'queued', updated_at = CURRENT_TIMESTAMP "
            "WHERE status = 'processing'"
        )
        rows = await conn.fetch(
            "SELECT file_id FROM extraction_jobs WHERE status = 'queued' "
            "ORDER BY updated_at ASC LIMIT $1",
            limit,
        )
    for r in rows:
        spawn_extraction(run_entity_extraction(int(r["file_id"]), None, None))
    if rows:
        log.info("entities.recovered", count=len(rows))
    return len(rows)


async def run_entity_extraction(
    file_id: int, llm_config: ChatConfig | None, chunk_table: str | None = None
) -> None:
    """Run one extraction job: atomic claim, attempt cap, then the worker.

    Only the process whose UPDATE flips queued->processing proceeds, so this
    is safe across workers. `llm_config=None` means boot recovery (keyless).
    """
    async with _in_progress_lock:
        if file_id in _in_progress:
            log.info("entities.already_running", file_id=file_id)
            return
        _in_progress.add(file_id)
    try:
        async with pool().acquire() as conn:
            job = await conn.fetchrow(
                "UPDATE extraction_jobs SET status = 'processing', attempts = attempts + 1, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE file_id = $1 AND status = 'queued' "
                "RETURNING attempts, llm_provider, llm_model, llm_base_url",
                file_id,
            )
        if job is None:
            return  # claimed elsewhere, or nothing queued
        if _give_up(int(job["attempts"])):
            await _finish(file_id, "failed", f"Extraction gave up after {int(job['attempts'])} attempts.")
            return

        cfg = llm_config
        if cfg is None:
            try:
                cfg = ChatConfig(
                    llm_provider=job["llm_provider"] or "local",
                    llm_model=job["llm_model"] or "llama3.2",
                    llm_base_url=job["llm_base_url"] or "",
                    api_key="",
                )
            except Exception:
                await _finish(file_id, "failed", "Stored job has an invalid LLM config — retry manually.")
                return

        table = chunk_table
        if table is None:
            async with pool().acquire() as conn:
                frow = await conn.fetchrow(
                    "SELECT embedding_model FROM uploaded_files WHERE id = $1", file_id
                )
                reg = (
                    await conn.fetchrow(
                        "SELECT table_name FROM embedding_model_registry WHERE model_name = $1",
                        frow["embedding_model"],
                    )
                    if frow
                    else None
                )
            if not reg:
                await _finish(file_id, "failed", "Chunk table for this file is gone.")
                return
            table = reg["table_name"]  # from our own registry — never user input

        # Cap simultaneous files so parallel uploads can't OOM local models.
        async with _semaphore():
            await _run(file_id, cfg, table)
    finally:
        async with _in_progress_lock:
            _in_progress.discard(file_id)


async def _run(file_id: int, llm_config: ChatConfig, chunk_table: str) -> None:
    # Fail fast when an API provider is configured without a key (recovery
    # runs keyless by design — keys are never persisted server-side).
    if llm_config.llm_provider in ("api", "custom") and not llm_config.api_key:
        await _finish(
            file_id,
            "failed",
            "API key unavailable — keys are never stored server-side. Retry from the app with a key.",
        )
        return
    # Low-temperature, short completions: extraction is not creative writing.
    cfg = llm_config.model_copy(update={"temperature": 0.1, "max_tokens": 1024})
    # Table name comes from our own registry via the caller — never user input.
    async with pool().acquire() as conn:
        await conn.execute(
            "UPDATE uploaded_files SET entity_status = 'processing', entity_error = NULL WHERE id = $1",
            file_id,
        )
        chunk_rows = await conn.fetch(
            f"SELECT id, content FROM {chunk_table} WHERE source_file_id = $1 "
            f"ORDER BY id ASC LIMIT {MAX_CHUNKS_PER_FILE}",
            file_id,
        )

    chunks = [(int(r["id"]), r["content"] or "") for r in chunk_rows if (r["content"] or "").strip()]
    if not chunks:
        await _finish(file_id, "failed", "No chunk text found for entity extraction.")
        return

    log.info("entities.start", file_id=file_id, chunks=len(chunks))
    from ..config import get_settings

    max_retries = max(1, get_settings().entity_max_retries)
    any_output = False
    mentions = 0
    rels = 0
    failed_batches = 0
    try:
        async with pool().acquire() as conn:
            for ix, batch in enumerate(batch_chunks(chunks)):
                joined = "\n\n---\n\n".join(t for _, t in batch)
                prompt = EXTRACTION_PROMPT.format(text=joined[:MAX_CHARS_PER_BATCH * 2])
                raw = await _with_retries(
                    f"file {file_id} batch {ix + 1}",
                    lambda: generate_once(prompt, cfg),
                    attempts=max_retries,
                )
                if not raw.strip():
                    failed_batches += 1
                    continue
                any_output = True
                parsed = parse_extraction_json(raw)
                # Mentions first so relation endpoints resolve to the same rows.
                for ent in parsed.entities:
                    # Attribute the mention to the batch's first chunk (provenance
                    # is chunk-granular; finer offsets are a future refinement).
                    eid = await _resolve_or_create_entity(conn, ent.name, ent.type, file_id, batch[0][0])
                    if eid is not None:
                        mentions += 1
                for rel in parsed.relations:
                    src_id = await _resolve_or_create_entity(conn, rel.source, "concept", file_id, batch[0][0])
                    dst_id = await _resolve_or_create_entity(conn, rel.target, "concept", file_id, batch[0][0])
                    if src_id is None or dst_id is None or src_id == dst_id:
                        continue
                    await conn.execute(
                        "INSERT INTO relations "
                        "(src_entity_id, dst_entity_id, label, source_file_id, chunk_id, confidence) "
                        "VALUES ($1, $2, $3, $4, $5, $6) "
                        "ON CONFLICT (src_entity_id, dst_entity_id, label, source_file_id) DO NOTHING",
                        src_id,
                        dst_id,
                        rel.label,
                        file_id,
                        batch[0][0],
                        rel.confidence,
                    )
                    rels += 1
    except Exception as exc:
        log.error("entities.failed", file_id=file_id, error=str(exc), exc_info=True)
        await _finish(file_id, "failed", str(exc)[:500])
        return

    if not any_output:
        await _finish(file_id, "failed", "LLM returned no output — is the chat model available?")
        return
    await _finish(file_id, "completed")
    log.info("entities.done", file_id=file_id, mentions=mentions, relations=rels,
             failed_batches=failed_batches)


async def _finish(file_id: int, status: str, error: str | None = None) -> None:
    async with pool().acquire() as conn:
        entity_count = await conn.fetchval(
            "SELECT COUNT(DISTINCT entity_id) FROM entity_mentions WHERE source_file_id = $1", file_id
        )
        relation_count = await conn.fetchval(
            "SELECT COUNT(*) FROM relations WHERE source_file_id = $1", file_id
        )
        await conn.execute(
            "UPDATE uploaded_files SET entity_status = $2, entity_error = $3, "
            "entity_count = $4, relation_count = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            file_id,
            status,
            error,
            int(entity_count or 0),
            int(relation_count or 0),
        )
        # Mirror onto the durable job row (completed/failed are terminal).
        if status in ("completed", "failed"):
            await conn.execute(
                "UPDATE extraction_jobs SET status = $2, error = $3, "
                "updated_at = CURRENT_TIMESTAMP WHERE file_id = $1",
                file_id,
                status,
                error,
            )


async def is_extracting(file_id: int) -> bool:
    async with _in_progress_lock:
        return file_id in _in_progress
