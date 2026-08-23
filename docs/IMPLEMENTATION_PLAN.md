# ragui Implementation Plan

Below is a phased, milestone-driven implementation plan derived from the v2.1 spec. It's structured so a developer (or AI coding assistant) can execute it sequentially, with clear deliverables, dependencies, and acceptance criteria at every step.

---

## 📋 Plan At-a-Glance

| Phase | Title | Est. Duration | Output |
|------|-------|---------------|--------|
| 0 | Project Bootstrap | 0.5 day | Repo skeleton, env files, Docker dev DB |
| 1 | Database Foundation | 1 day | Schema, migrations, dynamic table manager |
| 2 | Backend Core | 1 day | FastAPI app, config, health endpoint |
| 3 | Ingestion Pipeline | 2–3 days | Docling parsing, chunking, embedding, storage |
| 4 | Retrieval + Chat (SSE) | 2 days | Vector search, streaming generator |
| 5 | Sessions & Knowledge APIs | 1 day | CRUD endpoints for sessions, files, stats |
| 6 | Frontend Shell | 1 day | Next.js app, sidebar, Zustand stores |
| 7 | Chat View + Streaming UI | 1.5 days | Pill input, message bubbles, SSE reader |
| 8 | Upload + Preview UI | 1 day | DropZone, Docling preview, progress |
| 9 | Knowledge + History + Settings | 1.5 days | Dashboards, model picker, API key tester |
| 10 | Production Dockerization | 1 day | Prod compose, multi-stage builds, nginx |
| 11 | Hardening & QA | 1–2 days | Tests, logging, error UX, dedup, CORS |

**Total: ~14 working days for a single developer.**

---

## Phase 0 — Project Bootstrap (Day 1, AM)

### Tasks
1. Create root repo `ragui/` with the exact folder structure from §3.
2. Initialize git, add `.gitignore` (Python, Node, `.env*`, `.venv`, `__pycache__`, `.next`, `model_cache`).
3. Create env templates:
   - `.env.example` (root)
   - `backend/.env.example`
   - `frontend/.env.local.example`
4. Write `docker-compose.yml` (dev — Postgres + optional pgadmin profile).
5. Write `Makefile` (`dev-db`, `dev-backend`, `dev-frontend`, `prod-up`, `prod-down`, `clean`).
6. Draft `README.md` with the §9 dev workflow.

### Acceptance Criteria
- ✅ `make dev-db` starts Postgres on `localhost:5432`.
- ✅ `docker compose --profile tools up -d` exposes pgadmin on `:5050`.
- ✅ `psql -h localhost -U ragui ragui` succeeds.

---

## Phase 1 — Database Foundation (Day 1, PM → Day 2)

### Tasks
1. **`backend/app/database.py`**
   - Async connection pool with `asyncpg`.
   - `init_db()` runs at app startup (FastAPI lifespan).
   - Creates `pgvector` extension and the 4 core tables (§4.1).
2. **`backend/app/utils/model_registry.py`**
   - `MODEL_DIMENSIONS` dict.
   - `sanitize_model_name()`, `get_chunk_table_name()`.
   - Whitelist of allowed model names (anti-SQL-injection).
3. **Dynamic chunk table manager**
   - `ensure_chunk_table(model_name)`:
     - Validate model is in registry.
     - If table missing → `CREATE TABLE chunks_{...}` + HNSW index.
     - Insert row in `embedding_model_registry`.

### Acceptance Criteria
- ✅ App boot creates 4 core tables idempotently.
- ✅ Calling `ensure_chunk_table("all-MiniLM-L6-v2")` creates `chunks_all_minilm_l6_v2` with `VECTOR(384)` and HNSW index.
- ✅ Unknown models raise `ValueError`, never reach SQL.

---

## Phase 2 — Backend Core (Day 3)

### Tasks
1. **`config.py`** — Pydantic `Settings` with `ENVIRONMENT` detection. Default DB host = `localhost` (dev), `db` (prod via env var).
2. **`main.py`** — FastAPI app factory:
   - CORS middleware (env-driven `ALLOWED_ORIGINS`).
   - Lifespan handler → `init_db()` + warm embedding model.
   - Mount all routers under `/api`.
3. **`utils/logger.py`** — `structlog` JSON config; request middleware for latency logging.
4. **`routers/health.py`** — `GET /api/health` checks DB ping + Ollama HTTP probe.
5. **`requirements.txt`** + **`requirements-dev.txt`** (pytest, ruff, mypy).
6. **`run-dev.sh`** convenience script.

### Acceptance Criteria
- ✅ `uvicorn app.main:app --reload` starts cleanly.
- ✅ `GET /api/health` returns DB status + Ollama probe result.
- ✅ Logs are structured JSON.

---

## Phase 3 — Ingestion Pipeline (Days 4–6)

### Tasks
1. **`services/file_manager.py`**
   - SHA-256 hashing.
   - `check_duplicate(hash)` → returns existing `file_id` or `None`.
   - `insert_file_record()`, `update_file_status()`.
2. **`services/parser.py`**
   - Wraps Docling `DocumentConverter`.
   - Configurable OCR, table structure on.
   - Returns `(raw_markdown, document_object)`.
3. **`services/chunker.py`**
   - Uses Docling `HybridChunker` with the tokenizer matching the embedding model.
   - Extracts `page_range`, `heading_hierarchy`, `token_count` per chunk.
4. **`services/embedder.py`** — Strategy pattern:
   - `LocalEmbedder` (SentenceTransformers, lazy-loaded, cached).
   - `APIEmbedder` (OpenAI).
   - Common interface: `async embed(texts: list[str]) -> list[list[float]]`.
5. **`routers/ingest.py`** — `POST /api/ingest`:
   - Multipart parsing → validate size (50MB) + MIME.
   - Pipeline orchestration per §5.2 (steps 1–10).
   - Returns 409 on duplicates, 422 on validation, 500 with error_message on failure.
6. **Batch insert** chunks with `executemany` for performance.

### Acceptance Criteria
- ✅ Upload a PDF → returns `chunks[]`, `raw_markdown`, processing time.
- ✅ Re-upload same PDF → 409 with `existing_file_id`.
- ✅ Switching embedding models creates a new chunk table automatically.
- ✅ Failure mid-pipeline marks file as `failed` with `error_message`.

---

## Phase 4 — Retrieval + Chat Streaming (Days 7–8)

### Tasks
1. **`services/retriever.py`**
   - `retrieve(query, model, top_k)` → embeds query, runs cosine similarity on the correct chunk table, returns chunks + similarity scores.
   - Uses parameterized table name from registry (validated).
2. **`services/generator.py`** — Strategy pattern:
   - `OllamaGenerator` (httpx streaming).
   - `OpenAIGenerator` (`stream=True`).
   - Common interface: `async def stream(system, messages, config) -> AsyncGenerator[str]`.
3. **`routers/chat.py`** — `POST /api/chat` returns `StreamingResponse` with `text/event-stream`:
   - Emit `session` event (with new/existing session_id).
   - Emit `sources` event (retrieved chunks).
   - Stream `token` events.
   - Emit `done` event with full response.
   - Persist user + assistant messages with `retrieved_chunk_ids`.
4. **Session auto-titling**: after first exchange, call LLM with prompt "Summarize this in ≤50 chars" and update `chat_sessions.title`.

### Acceptance Criteria
- ✅ `curl -N` to `/api/chat` streams tokens in real time.
- ✅ Sources event arrives before any token.
- ✅ Messages saved with chunk references.
- ✅ Session title auto-generates after first reply.

---

## Phase 5 — Sessions & Knowledge APIs (Day 9)

### Tasks
1. **`routers/sessions.py`** — `GET /api/sessions`, `GET /api/sessions/{id}/messages`, `DELETE /api/sessions/{id}`.
2. **`routers/knowledge.py`** — `GET /api/knowledge/stats`, `GET /api/knowledge/files`, `DELETE /api/knowledge/files/{id}` (cascades chunks via FK).

### Acceptance Criteria
- ✅ All endpoints return shapes exactly matching §5.4–5.5.
- ✅ File deletion removes associated chunks (verified by chunk count).

---

## Phase 6 — Frontend Shell (Day 10)

### Tasks
1. `npx create-next-app` (App Router, TS, Tailwind).
2. Configure `tailwind.config.ts` with dark zinc palette.
3. **Zustand stores** (`configStore`, `chatStore`, `viewStore`) — see §6.1.
4. **`lib/api.ts`** — typed fetch wrappers + `streamChat` async generator (§6.3).
5. **`lib/constants.ts`** — model lists, defaults.
6. **`types/index.ts`** — shared interfaces.
7. **`Sidebar.tsx`** + **`SidebarIcon.tsx`** — Lucide icons, tooltips, active state, settings anchored to bottom.
8. **`app/layout.tsx`** — sidebar + active view router using `viewStore`.
9. **`next.config.js`** — dev proxy `/api/*` → `localhost:8000`.

### Acceptance Criteria
- ✅ `npm run dev` boots on `:3000`, dark themed, sidebar renders.
- ✅ Clicking icons swaps the right-side view (even with placeholder content).

---

## Phase 7 — Chat View + Streaming UI (Days 11–12)

### Tasks
1. **`ChatView.tsx`** — message list, auto-scroll on new tokens.
2. **`MessageBubble.tsx`** — user (right, zinc-800) vs assistant (left, zinc-900); source citation chips.
3. **`StreamingText.tsx`** — consumes `streamChat()` generator, appends tokens.
4. **`ChatInput.tsx`** — pill-shaped, submit button inside flush right, disabled during stream.
5. Source chips clickable → modal showing chunk content.

### Acceptance Criteria
- ✅ Typing a question shows live token-by-token response.
- ✅ Sources appear above the assistant message as chips.
- ✅ "New Chat" sidebar action resets state, starts a fresh session.

---

## Phase 8 — Upload + Preview UI (Day 13)

### Tasks
1. **`DropZone.tsx`** — drag-and-drop + click-to-browse, validates type/size client-side.
2. Progress bar driven by upload `XMLHttpRequest` (real progress).
3. **`DoclingPreview.tsx`** — split panel: rendered markdown (left) + chunk cards (right) with page range + token count.
4. Error states: file too large, unsupported MIME, 409 duplicate (with "View existing" button).

### Acceptance Criteria
- ✅ Upload a PDF → progress → preview both markdown and chunks.
- ✅ Drop a `.exe` → blocked with friendly error.

---

## Phase 9 — Knowledge, History, Settings (Days 14–15)

### Tasks
1. **`KnowledgeView.tsx`** — stat cards, files table with delete, models-in-use list.
2. **`HistoryPanel.tsx`** — past sessions, click to load messages, delete action.
3. **`SettingsPanel.tsx`**:
   - Provider toggle (local/api) for embedding + LLM.
   - Model dropdowns (filter by provider).
   - API key masked input + **Test** button → calls a backend `/api/test-key` endpoint (add this minor endpoint).
   - Top-K slider, temperature, max tokens, OCR toggle.
   - Ollama status panel (polls `/api/health`).
4. Persist `configStore` to `localStorage`.

### Acceptance Criteria
- ✅ Switching embedding model in Settings affects next upload's table choice.
- ✅ Switching LLM model affects next chat without page refresh.
- ✅ Ollama-down → local options grayed out with tooltip.

---

## Phase 10 — Production Dockerization (Day 16)

### Tasks
1. **`backend/Dockerfile`** — slim Python 3.12, CPU-only torch wheel, multi-worker uvicorn.
2. **`frontend/Dockerfile`** — multi-stage (deps → builder → runner), Next standalone output recommended.
3. **`docker-compose.prod.yml`** — db + backend + frontend + optional nginx profile.
4. **`nginx/nginx.conf`** — reverse proxy with SSE buffering disabled (`proxy_buffering off;` on `/api/chat`).
5. Verify CPU-only torch (`--extra-index-url https://download.pytorch.org/whl/cpu`).
6. `model_cache` volume mounted for SentenceTransformers cache.

### Acceptance Criteria
- ✅ `make prod-up` brings up full stack; `/api/health` green.
- ✅ Backend image is < 2GB (no CUDA binaries).
- ✅ SSE works through nginx reverse proxy.

---

## Phase 11 — Hardening & QA (Days 17–18)

### Tasks
1. **Backend tests** (`pytest` + `httpx`):
   - Ingest happy path + duplicate + bad file.
   - Chat SSE event ordering.
   - Knowledge endpoint shapes.
2. **Model registry guard tests** — ensure unknown model names raise before SQL.
3. **CORS check** in both environments.
4. **Logging review** — ensure latency + error logs are present at each pipeline stage.
5. **Manual QA matrix**:
   | Scenario | Expected |
   |---|---|
   | Upload PDF with OCR off | Works for native PDFs |
   | Upload scanned PDF with OCR on | Text extracted |
   | Switch embedding mid-session | Warned (sessions lock model) |
   | Delete file | Chunks gone, search excludes them |
   | Ollama offline | Settings disables local; API still works |
   | API key invalid | Friendly 401 surface in UI |

### Acceptance Criteria
- ✅ All tests pass in CI (GitHub Actions optional but recommended).
- ✅ No `psycopg`/`asyncpg` warnings at startup.
- ✅ No console errors in the browser during a full upload→chat flow.

---

## 🔑 Critical Risk Areas (Watch Closely)

| Risk | Mitigation |
|---|---|
| **Docling Python version drift** | Pin exact version in `requirements.txt`; CI smoke test the import. |
| **HNSW index slow build on large uploads** | Build index *after* batch insert is fine for v1; consider `ef_construction` tuning later. |
| **SSE buffering by proxies** | Set `X-Accel-Buffering: no` header on chat responses; verify nginx config. |
| **NEXT_PUBLIC_API_URL baked at build** | Document clearly that prod rebuilds are required if API URL changes. |
| **Dynamic SQL table names** | Strict whitelist via `model_registry`; unit-test injection attempts. |
| **First-time model download size** | Warn user in UI during first embed; cache in volume. |
| **Ollama on Linux host networking** | Document `--add-host=host.docker.internal:host-gateway` in README. |

---

## 📦 Suggested Deliverable Cadence

- **End of Phase 5** → Backend MVP demoable via `curl`.
- **End of Phase 8** → Full ingest+chat loop works in browser.
- **End of Phase 10** → Deployable to a VPS.
- **End of Phase 11** → Production-ready v1.0 tag.

---

## ✅ Definition of Done (v1.0)

1. User can upload PDF/DOCX/HTML/PPTX/MD and see Docling preview.
2. User can chat with streamed responses citing sources.
3. User can switch embedding & LLM models (local or API) without restarting.
4. Duplicate detection works.
5. Knowledge dashboard shows accurate stats.
6. History persists across reloads.
7. App runs identically in dev (native) and prod (Docker).
8. Health endpoint reports DB and Ollama status accurately.

---
