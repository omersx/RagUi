
Master Developer Specification: ragui (v2.0)

1. Project Overview

ragui is a containerized, full-stack Retrieval-Augmented Generation (RAG) application with a modern sidebar-navigated UI. Users can upload documents, which are parsed via Docling into structured Markdown, contextually chunked, embedded, and stored in PostgreSQL with pgvector. The app supports dynamic switching between local CPU-based models (Ollama/SentenceTransformers) and cloud APIs (OpenAI) for both embedding and generation, with streamed chat responses.
-------------------------

2. Technical Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind CSS, Zustand, Lucide React |
| **Backend** | Python 3.12, FastAPI, PyTorch (CPU), sentence-transformers, openai, docling, asyncpg, SSE (Server-Sent Events) |
| **Database** | PostgreSQL 16 + pgvector 0.7+ |
| **Local AI** | Ollama (optional sidecar container) |
| Dev Workflow |	npm run dev (frontend) + uvicorn --reload (backend) + Docker for Postgres only
| Prod Deployment| Full Docker Compose stack (docker-compose.prod.yml)



----------------------------------------------------------------------------------
# Updated Master Developer Specification: ragui (v2.1)

I've updated the plan to support **hybrid development**: run the frontend and backend locally with `npm run dev` / `uvicorn --reload` for fast iteration, while using **Docker only for production deployment** (and optionally for the database during development).

Below are the **changed/added sections only** — everything else from v2.0 stays the same.

---

## 2. Technical Stack (Updated)

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind CSS, Zustand, Lucide React |
| **Backend** | Python 3.12, FastAPI, PyTorch (CPU), sentence-transformers, openai, docling, asyncpg, SSE |
| **Database** | PostgreSQL 16 + pgvector 0.7+ |
| **Local AI** | Ollama (host machine in dev, sidecar/host in prod) |
| **Dev Workflow** | `npm run dev` (frontend) + `uvicorn --reload` (backend) + Docker for Postgres only |
| **Prod Deployment** | Full Docker Compose stack (`docker-compose.prod.yml`) |

---

## 3. Folder Structure (Updated)

ragui/
├── docker-compose.yml              # DEV: only Postgres (+ optional pgadmin)
├── docker-compose.prod.yml         # PROD: full stack (db + backend + frontend)
├── .env.example                    # Shared env template
├── .env.development                # Local dev values (gitignored)
├── .env.production                 # Production values (gitignored)
├── Makefile                        # Shortcut commands (optional)
├── README.md                       # Setup instructions for both modes
│
├── backend/
│   ├── Dockerfile                  # Production image
│   ├── Dockerfile.dev              # OPTIONAL: dev image with hot-reload
│   ├── requirements.txt
│   ├── requirements-dev.txt        # Dev dependencies (pytest, ruff, mypy, etc.)
│   ├── .env.example                # Backend-specific env template
│   ├── run-dev.sh                  # Shell script: uvicorn with reload
│   └── app/
│       ├── __init__.py
│       ├── main.py                 # FastAPI app factory, CORS, lifespan
│       ├── config.py               # Pydantic Settings (env vars, defaults)
│       ├── database.py             # Async connection pool, table management
│       ├── models/
│       │   ├── __init__.py
│       │   ├── schemas.py          # Pydantic request/response models
│       │   └── enums.py            # Provider enums
│       ├── services/
│       │   ├── __init__.py
│       │   ├── parser.py           # Docling document conversion
│       │   ├── chunker.py          # Docling HybridChunker logic
│       │   ├── embedder.py         # Embedding abstraction (local/API)
│       │   ├── retriever.py        # pgvector similarity search
│       │   ├── generator.py        # LLM generation (Ollama/OpenAI) w/ streaming
│       │   └── file_manager.py     # File tracking, deduplication
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── ingest.py           # POST /api/ingest
│       │   ├── chat.py             # POST /api/chat (SSE streaming)
│       │   ├── knowledge.py        # GET /api/knowledge/* endpoints
│       │   ├── sessions.py         # Chat history CRUD
│       │   └── health.py           # GET /api/health
│       ├── utils/
│       │   ├── __init__.py
│       │   ├── logger.py           # Structured logging setup
│       │   └── model_registry.py   # Known models + dimension mapping
│       └── tests/                  # (if you still keep tests here; original had backend/tests/)
│           └── ...
│
└── frontend/
    ├── Dockerfile                  # Production image (multi-stage build)
    ├── .env.local.example          # NEXT_PUBLIC_API_URL=http://localhost:8000
    ├── package.json                # npm run dev | build | start
    ├── next.config.js              # Includes API proxy for dev
    ├── tailwind.config.ts          # Tailwind CSS configuration (kept from original)
    ├── tsconfig.json               # TypeScript configuration (kept from original)
    └── src/
        ├── app/
        │   ├── layout.tsx           # Root layout with sidebar
        │   ├── page.tsx             # Redirects to /chat
        │   ├── globals.css
        │   └── providers.tsx        # Zustand provider wrapper
        ├── components/
        │   ├── sidebar/
        │   │   ├── Sidebar.tsx      # Main sidebar container
        │   │   └── SidebarIcon.tsx  # Reusable icon button
        │   ├── chat/
        │   │   ├── ChatView.tsx     # Chat viewport container
        │   │   ├── MessageBubble.tsx
        │   │   ├── ChatInput.tsx    # Pill-shaped input with submit button
        │   │   └── StreamingText.tsx # Handles SSE token display
        │   ├── upload/
        │   │   ├── UploadView.tsx   
        │   │   ├── DropZone.tsx     # Drag-and-drop area
        │   │   └── DoclingPreview.tsx # Side-by-side markdown + chunks
        │   ├── knowledge/
        │   │   └── KnowledgeView.tsx # DB stats dashboard
        │   ├── history/
        │   │   └── HistoryPanel.tsx  # Past sessions list
        │   └── settings/
        │       └── SettingsPanel.tsx  # Model selection, API keys
        ├── stores/
        │   ├── configStore.ts       # Zustand store for user config
        │   ├── chatStore.ts         # Zustand store for active chat state
        │   └── viewStore.ts         # Zustand store for active viewport
        ├── lib/
        │   ├── api.ts               # Typed fetch wrappers for backend
        │   └── constants.ts         # Model lists, defaults
        └── types/
            └── index.ts             # Shared TypeScript interfaces

-------------------------

4. Database Schema

4.1 Core Tables (Created at Startup)


CREATE EXTENSION IF NOT EXISTS vector;

-- Track all uploaded files
CREATE TABLE IF NOT EXISTS uploaded_files (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 for deduplication
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    raw_markdown TEXT,                       -- Full Docling markdown output
    total_chunks INTEGER DEFAULT 0,
    embedding_model VARCHAR(100),
    status VARCHAR(20) DEFAULT 'processing', -- processing | completed | failed
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) DEFAULT 'New Chat',
    embedding_model VARCHAR(100) NOT NULL,   -- Locked at creation time
    llm_model VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,               -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    retrieved_chunk_ids INTEGER[],           -- References to chunks used
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model registry (tracks dynamically created chunk tables)
CREATE TABLE IF NOT EXISTS embedding_model_registry (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(100) UNIQUE NOT NULL,
    provider VARCHAR(20) NOT NULL,           -- 'local' | 'api'
    dimensions INTEGER NOT NULL,
    table_name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


4.2 Dynamic Chunk Tables (Created Per Embedding Model)

When a new embedding model is used for the first time, the backend automatically creates:

-- Example: model "all-MiniLM-L6-v2" → table "chunks_all_minilm_l6_v2"
CREATE TABLE IF NOT EXISTS chunks_{sanitized_model_name} (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    source_file_id INTEGER REFERENCES uploaded_files(id) ON DELETE CASCADE,
    page_range INT[],
    heading_hierarchy TEXT[],
    token_count INTEGER,
    embedding VECTOR({dimensions}) NOT NULL,  -- Fixed per table!
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_{sanitized_model_name}_hnsw 
ON chunks_{sanitized_model_name} 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);


4.3 Model Registry Helper (Python)


# backend/app/utils/model_registry.py

MODEL_DIMENSIONS = {
    # Local (SentenceTransformers)
    "all-MiniLM-L6-v2": 384,
    "all-mpnet-base-v2": 768,
    "bge-small-en-v1.5": 384,
    # API (OpenAI)
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}

def sanitize_model_name(model: str) -> str:
    """Convert model name to valid PostgreSQL table suffix."""
    return model.lower().replace("-", "_").replace(".", "_").replace("/", "_")

def get_chunk_table_name(model: str) -> str:
    return f"chunks_{sanitize_model_name(model)}"


-------------------------

5. Backend API Specification

5.1 Health Check


GET /api/health
Response: {
    "status": "healthy",
    "database": "connected",
    "ollama": "available" | "unavailable",
    "loaded_models": ["all-MiniLM-L6-v2"]
}


5.2 Document Ingestion


POST /api/ingest
Content-Type: multipart/form-data

Fields:
  - file: Binary (PDF, DOCX, HTML, PPTX, MD)
  - embedding_provider: "local" | "api"
  - embedding_model: string
  - api_key: string (optional, required if provider=api)
  - ocr_enabled: boolean (default: false)
  - max_tokens: integer (default: 512)

Response 200:
{
    "status": "success",
    "file_id": 42,
    "filename": "report.pdf",
    "raw_markdown": "# Introduction\n...",
    "chunks": [
        {
            "id": 1,
            "content": "The quarterly results...",
            "page_range": [1, 2],
            "heading_hierarchy": ["Introduction", "Overview"],
            "token_count": 127
        }
    ],
    "total_chunks": 15,
    "embedding_model": "all-MiniLM-L6-v2",
    "processing_time_seconds": 4.2
}

Response 409 (Duplicate):
{
    "status": "duplicate",
    "message": "File already ingested",
    "existing_file_id": 42
}

Response 422 (Validation Error):
{
    "detail": "Unsupported file type: .exe"
}


Ingestion Pipeline Detail:

async def ingest_file(file, config):
    # 1. Compute SHA-256 hash
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    
    # 2. Check for duplicates
    existing = await db.fetch_one(
        "SELECT id FROM uploaded_files WHERE file_hash = $1", file_hash
    )
    if existing:
        return DuplicateResponse(existing_file_id=existing['id'])
    
    # 3. Insert file record with status='processing'
    file_id = await db.insert_file(filename, file_hash, ...)
    
    try:
        # 4. Parse with Docling
        converter = DocumentConverter(
            do_ocr=config.ocr_enabled,
            do_table_structure=True
        )
        result = converter.convert(file_path)
        raw_markdown = result.document.export_to_markdown()
        
        # 5. Chunk with HybridChunker
        tokenizer = AutoTokenizer.from_pretrained(config.embedding_model)
        chunker = HybridChunker(
            tokenizer=tokenizer,
            max_tokens=config.max_tokens,
            merge_peers=True
        )
        chunks = list(chunker.chunk(result.document))
        
        # 6. Extract metadata per chunk
        chunk_data = []
        for chunk in chunks:
            meta = chunk.meta
            chunk_data.append({
                "content": chunk.text,
                "page_range": extract_page_range(meta),
                "heading_hierarchy": extract_headings(meta),
                "token_count": len(tokenizer.encode(chunk.text))
            })
        
        # 7. Embed all chunks
        texts = [c["content"] for c in chunk_data]
        vectors = await embed_texts(texts, config)
        
        # 8. Ensure chunk table exists for this model
        table = await ensure_chunk_table(config.embedding_model)
        
        # 9. Batch insert chunks with embeddings
        await batch_insert_chunks(table, file_id, chunk_data, vectors)
        
        # 10. Update file record
        await db.update_file(file_id, 
            status='completed', 
            raw_markdown=raw_markdown,
            total_chunks=len(chunks)
        )
        
    except Exception as e:
        await db.update_file(file_id, status='failed', error_message=str(e))
        raise


5.3 Chat (Streaming via SSE)


POST /api/chat
Content-Type: application/json

Body:
{
    "session_id": "uuid" | null,       // null = new session
    "messages": [
        {"role": "user", "content": "What were the Q3 results?"}
    ],
    "config": {
        "llm_provider": "local",
        "llm_model": "llama3.2",
        "embedding_provider": "local",
        "embedding_model": "all-MiniLM-L6-v2",
        "api_key": "",
        "top_k": 5,
        "temperature": 0.7
    }
}

Response: text/event-stream (SSE)

data: {"type": "session", "session_id": "abc-123"}
data: {"type": "sources", "chunks": [{...}, {...}]}
data: {"type": "token", "content": "The"}
data: {"type": "token", "content": " quarterly"}
data: {"type": "token", "content": " results"}
data: {"type": "done", "full_response": "The quarterly results..."}


Chat Pipeline Detail:

async def chat_stream(request: ChatRequest):
    # 1. Get or create session
    session = await get_or_create_session(request.session_id, request.config)
    
    # 2. Save user message
    await save_message(session.id, "user", request.messages[-1].content)
    
    # 3. Embed the query
    query_vector = await embed_texts(
        [request.messages[-1].content], 
        request.config
    )
    
    # 4. Retrieve relevant chunks
    table = get_chunk_table_name(request.config.embedding_model)
    chunks = await db.fetch_all(f"""
        SELECT id, content, page_range, heading_hierarchy, 
               1 - (embedding <=> $1::vector) as similarity
        FROM {table}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
    """, query_vector[0], request.config.top_k)
    
    # 5. Build augmented prompt
    context = "\n\n---\n\n".join([
        f"[Source: {c['heading_hierarchy']}, Pages: {c['page_range']}]\n{c['content']}"
        for c in chunks
    ])
    
    system_prompt = f"""You are a helpful assistant. Answer the user's question 
    based on the following retrieved context. If the context doesn't contain 
    relevant information, say so honestly. Always cite which section the 
    information comes from.
    
    CONTEXT:
    {context}"""
    
    # 6. Stream the response
    full_response = ""
    async for token in generate_stream(system_prompt, request.messages, request.config):
        full_response += token
        yield sse_event("token", {"content": token})
    
    # 7. Save assistant message
    chunk_ids = [c['id'] for c in chunks]
    await save_message(session.id, "assistant", full_response, chunk_ids)
    
    yield sse_event("done", {"full_response": full_response})


5.4 Knowledge Base Endpoints


GET /api/knowledge/stats
Response: {
    "total_files": 12,
    "total_chunks": 847,
    "models_used": [
        {"model": "all-MiniLM-L6-v2", "chunk_count": 500, "file_count": 8},
        {"model": "text-embedding-3-small", "chunk_count": 347, "file_count": 4}
    ],
    "total_storage_mb": 45.2
}

GET /api/knowledge/files
Response: [
    {
        "id": 1,
        "filename": "report.pdf",
        "status": "completed",
        "total_chunks": 42,
        "embedding_model": "all-MiniLM-L6-v2",
        "created_at": "2024-01-15T10:30:00Z"
    }
]

DELETE /api/knowledge/files/{file_id}
Response: {"status": "deleted", "chunks_removed": 42}


5.5 Session Endpoints


GET /api/sessions
Response: [
    {
        "id": "uuid",
        "title": "Q3 Financial Analysis",
        "message_count": 12,
        "created_at": "...",
        "updated_at": "..."
    }
]

GET /api/sessions/{id}/messages
Response: [
    {"role": "user", "content": "...", "created_at": "..."},
    {"role": "assistant", "content": "...", "retrieved_chunk_ids": [1,2,3], "created_at": "..."}
]

DELETE /api/sessions/{id}


-------------------------

6. Frontend UI Specification

6.1 Global State (Zustand Stores)


// stores/configStore.ts
interface ConfigState {
    llmProvider: 'local' | 'api';
    llmModel: string;
    embeddingProvider: 'local' | 'api';
    embeddingModel: string;
    apiKeys: { openai: string };
    topK: number;
    temperature: number;
    ocrEnabled: boolean;
    // Actions
    setLlmProvider: (p: 'local' | 'api') => void;
    setLlmModel: (m: string) => void;
    // ... etc
}

// stores/viewStore.ts
type ActiveView = 'chat' | 'history' | 'knowledge' | 'upload' | 'settings';
interface ViewState {
    activeView: ActiveView;
    setActiveView: (v: ActiveView) => void;
}

// stores/chatStore.ts
interface ChatState {
    sessionId: string | null;
    messages: Message[];
    isStreaming: boolean;
    sources: ChunkSource[];
    // Actions
    addMessage: (msg: Message) => void;
    setStreaming: (s: boolean) => void;
    resetChat: () => void;
}


6.2 Sidebar Component


┌─────┐
│ragui│  ← Plain text logo, font-mono, text-sm
│     │
│ [✏️] │  ← New Chat: resets chatStore, sets view='chat'
│ [📋] │  ← History: sets view='history'
│ [📊] │  ← Knowledge Base: sets view='knowledge'  
│ [📥] │  ← Upload: sets view='upload'
│     │
│     │
│     │
│ [⚙️] │  ← Settings: sets view='settings' (anchored to bottom)
└─────┘


- Width: w-16 (4rem)
- Background: bg-zinc-950 (near-black)
- Icons: Lucide React, text-zinc-400 hover:text-white
- Active state: text-white bg-zinc-800 rounded-lg
- Tooltip on hover showing the label
6.3 Chat View


┌──────────────────────────────────────────────┐
│                   chat ui                     │  ← text-center, text-zinc-500, text-sm
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│                    ┌─────────────────────┐   │
│                    │ What were Q3 results?│   │  ← User bubble: bg-zinc-800, rounded-2xl
│                    └─────────────────────┘   │
│   ┌────────────────────────────────┐         │
│   │ Based on the report, Q3...     │         │  ← Assistant: bg-zinc-900, rounded-2xl
│   │ [📄 report.pdf, p.3-4]        │         │  ← Source citation chips
│   └────────────────────────────────┘         │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│   ┌──────────────────────────────────[→]┐    │  ← Pill input: bg-zinc-800, rounded-full
│   │ Ask about your documents...          │    │    Submit button: bg-white rounded-full
│   └─────────────────────────────────────┘    │    inside the pill, flush right
└──────────────────────────────────────────────┘


Streaming implementation:

// lib/api.ts
async function* streamChat(body: ChatRequest): AsyncGenerator<SSEEvent> {
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                yield JSON.parse(line.slice(6));
            }
        }
    }
}


6.4 Upload View


┌──────────────────────────────────────────────┐
│                                              │
│       ┌────────────────────────────┐         │
│       │                            │         │
│       │    📄 Drop files here      │         │  ← Dashed border, bg-zinc-900
│       │    or click to browse      │         │
│       │                            │         │
│       │  PDF, DOCX, HTML, PPTX     │         │  ← Supported types shown
│       │  Max 50MB                  │         │  ← File size limit shown
│       └────────────────────────────┘         │
│                                              │
│  ┌─ Processing ────────────────────────────┐ │
│  │ ████████████░░░░░░░░  45% Chunking...   │ │  ← Progress bar during ingestion
│  └─────────────────────────────────────────┘ │
│                                              │
│  After completion: Side-by-Side Preview      │
│  ┌──────────────────┬──────────────────────┐ │
│  │ Raw Markdown      │  Chunk Cards         │ │
│  │ # Introduction    │ ┌─────────────────┐  │ │
│  │ The quarterly...  │ │ Chunk 1 (p.1-2) │  │ │
│  │                   │ │ 127 tokens      │  │ │
│  │                   │ │ "The quarterly..│  │ │
│  │                   │ └─────────────────┘  │ │
│  └──────────────────┴──────────────────────┘ │
└──────────────────────────────────────────────┘


6.5 Knowledge Base View


┌──────────────────────────────────────────────┐
│              Knowledge Base                   │
├──────────────────────────────────────────────┤
│                                              │
│  📁 12 Files    📦 847 Chunks    💾 45.2 MB   │  ← Stat cards
│                                              │
│  ┌─ Indexed Files ─────────────────────────┐ │
│  │ File              Chunks  Model   Date  │ │
│  │ report.pdf        42      MiniLM  1/15  │ │
│  │ handbook.docx     105     MiniLM  1/16  │ │  ← With delete button per row
│  │ slides.pptx       23      GPT3sm  1/17  │ │
│  └──────────────────────────────────────────┘ │
│                                              │
│  ┌─ Models in Use ─────────────────────────┐ │
│  │ all-MiniLM-L6-v2    500 chunks, 8 files │ │
│  │ text-embed-3-small  347 chunks, 4 files │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘


6.6 Settings Panel


┌──────────────────────────────────────────────┐
│              Settings                         │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─ Embedding Model ──────────────────────┐ │
│  │ Provider:  [Local ▼]  [API ▼]          │ │
│  │ Model:     [all-MiniLM-L6-v2    ▼]     │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ LLM Model ────────────────────────────┐ │
│  │ Provider:  [Local ▼]  [API ▼]          │ │
│  │ Model:     [llama3.2            ▼]     │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ API Keys ─────────────────────────────┐ │
│  │ OpenAI: [sk-••••••••••••••••]  [Test]  │ │  ← Masked input + validation
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ Advanced ─────────────────────────────┐ │
│  │ Top-K Results:     [5      ]           │ │
│  │ Temperature:       [0.7    ]           │ │
│  │ Max Chunk Tokens:  [512    ]           │ │
│  │ Enable OCR:        [Toggle ]           │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ Ollama Status ────────────────────────┐ │
│  │ 🟢 Connected (localhost:11434)          │ │
│  │ Available: llama3.2, mistral, phi3     │ │  ← Auto-detected
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘


-------------------------
## 7. Docker Compose — TWO FILES

### 7.1 `docker-compose.yml` (Development — Postgres Only)

This is what you run during dev. It **only spins up Postgres** so you can run `npm run dev` and `uvicorn --reload` natively on your host.

```yaml
version: '3.8'

services:
  db:
    image: pgvector/pgvector:pg16
    container_name: ragui_db_dev
    environment:
      POSTGRES_DB: ragui
      POSTGRES_USER: ragui
      POSTGRES_PASSWORD: ${DB_PASSWORD:-ragui_dev}
    ports:
      - "5432:5432"               # Exposed so host-side backend can connect
    volumes:
      - pgdata_dev:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ragui"]
      interval: 5s
      timeout: 5s
      retries: 5

  # OPTIONAL: handy DB GUI at http://localhost:5050
  pgadmin:
    image: dpage/pgadmin4
    container_name: ragui_pgadmin
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@ragui.local
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    depends_on:
      - db
    profiles: ["tools"]            # Only starts with: docker compose --profile tools up

volumes:
  pgdata_dev:
```

### 7.2 `docker-compose.prod.yml` (Production — Full Stack)

```yaml
version: '3.8'

services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: ragui
      POSTGRES_USER: ragui
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ragui"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql+asyncpg://ragui:${DB_PASSWORD}@db:5432/ragui
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      MAX_UPLOAD_SIZE_MB: 50
      ENVIRONMENT: production
    volumes:
      - model_cache:/root/.cache
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${PUBLIC_API_URL}
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped

  # Optional reverse proxy — production only
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - frontend
      - backend
    restart: unless-stopped
    profiles: ["with-proxy"]

volumes:
  pgdata:
  model_cache:
```

---

## 8. Dockerfiles

### 8.1 `backend/Dockerfile` (Production)

```dockerfile
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

EXPOSE 8000

# No --reload in production
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### 8.2 `frontend/Dockerfile` (Production — Multi-stage)

```dockerfile
# ---- Stage 1: deps ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Stage 2: builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ---- Stage 3: runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "run", "start"]
```

---

## 9. Development Workflow (NEW SECTION)

### 9.1 First-Time Setup

```bash
# 1. Clone & copy env files
cp .env.example .env.development
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# 2. Start Postgres only
docker compose up -d db

# 3. Backend setup (in a terminal)
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install --extra-index-url https://download.pytorch.org/whl/cpu torch
pip install -r requirements.txt

# 4. Frontend setup (in another terminal)
cd frontend
npm install
```

### 9.2 Daily Development

Open **3 terminals**:

```bash
# Terminal 1 — Database (only need this once per session)
docker compose up -d db

# Terminal 2 — Backend with hot reload
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 3 — Frontend with hot reload
cd frontend
npm run dev
```

Then open <http://localhost:3000>. ✨

### 9.3 Production Deployment

```bash
# Build and run the full stack
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# With reverse proxy
docker compose -f docker-compose.prod.yml --profile with-proxy up -d --build

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop
docker compose -f docker-compose.prod.yml down
```

### 9.4 Optional `Makefile` (Recommended)

```makefile
.PHONY: dev-db dev-backend dev-frontend prod-up prod-down logs clean

# --- Development ---
dev-db:
	docker compose up -d db

dev-backend:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev: dev-db
	@echo "DB started. Now run 'make dev-backend' and 'make dev-frontend' in separate terminals."

# --- Production ---
prod-up:
	docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

prod-down:
	docker compose -f docker-compose.prod.yml down

logs:
	docker compose -f docker-compose.prod.yml logs -f

# --- Utilities ---
clean:
	docker compose down -v
	docker compose -f docker-compose.prod.yml down -v
```

Now you can just type `make dev-db`, `make prod-up`, etc.

---

## 10. Environment Files (NEW SECTION)

### 10.1 Root `.env.example`

```bash
# Database
DB_PASSWORD=ragui_dev

# Production-only
PUBLIC_API_URL=https://api.yourdomain.com
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

### 10.2 `backend/.env.example`

```bash
# Used when running backend natively (npm-style dev mode)
DATABASE_URL=postgresql+asyncpg://ragui:ragui_dev@localhost:5432/ragui
OLLAMA_BASE_URL=http://localhost:11434
MAX_UPLOAD_SIZE_MB=50
ENVIRONMENT=development
LOG_LEVEL=DEBUG
```

> 🔑 **Important**: In dev mode, the backend connects to `localhost:5432` (your host), not `db:5432` (Docker network).

### 10.3 `frontend/.env.local.example`

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 10.4 `frontend/next.config.js` (Dev API Proxy — Optional)

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Only proxy in dev — avoids CORS headaches
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8000/api/:path*',
        },
      ];
    }
    return [];
  },
};

module.exports = nextConfig;
```



-------------------------

11. Critical Implementation Directives (Updated)
- **Dual Environment Awareness**: `config.py` must detect `ENVIRONMENT=development|production` and load accordingly. Default `DATABASE_URL` host should be `localhost` for dev and `db` for prod.
- **CORS Configuration**: In dev mode, allow `http://localhost:3000`. In prod, restrict to your actual domain via env var (`ALLOWED_ORIGINS`).
- **No `--reload` in Production**: The production Dockerfile must NOT use `--reload`. Use `--workers 2` (or more, based on CPU count) instead.
- **Volume Mounts Removed in Prod**: Do not mount `./backend:/app` in `docker-compose.prod.yml` — the code is baked into the image.
- **Frontend Build-time Env Vars**: `NEXT_PUBLIC_*` vars are baked at build time. Pass them via `build.args` in compose, not runtime `environment`.
- **Database Persistence**: Use **separate volumes** for dev and prod (`pgdata_dev` vs `pgdata`) to avoid accidentally mixing data.
- **Ollama Connection**: In native dev mode, connect to `http://localhost:11434`. In Dockerized prod on the same host, use `http://host.docker.internal:11434` (Linux requires `--add-host=host.docker.internal:host-gateway`).
- Container Optimization: Backend Dockerfile MUST use --extra-index-url https://download.pytorch.org/whl/cpu torch to avoid GPU/CUDA binaries (~4GB savings).
- CORS: FastAPI must include:
- Dynamic Table Management: Never hardcode vector dimensions. Use the model registry to create properly typed tables on-the-fly.
- Streaming First: Chat responses MUST use Server-Sent Events. Never buffer the full response before sending.
- File Deduplication: Always compute SHA-256 of uploaded files and reject duplicates with a 409 response.
- Graceful Degradation: If Ollama is unavailable, the health endpoint reports it, and the Settings UI disables local model options. The app still works with API providers.
- Model Cache Volume: Mount a Docker volume for ~/.cache to persist downloaded SentenceTransformer models across container restarts.
- Input Validation: Enforce file size limits (50MB default), validate file types by both extension and MIME type, and sanitize all user inputs.
- SQL Injection Prevention: Dynamic table names must be validated against the model registry — never interpolate raw user input into SQL.
- Session Auto-Titling: After the first exchange in a chat session, use the LLM to generate a short title (≤50 chars) and update the session record.
- Logging: Use Python's structlog for JSON-formatted logs. Log all ingestion events, errors, and query latencies.
- Frontend Styling: Use Tailwind CSS exclusively. Dark theme (bg-zinc-950 background, text-zinc-100 text). No component libraries — keep it custom and lightweight matching the wireframe sketch.
-------------------------

This specification should now be complete, architecturally sound, and ready to hand to a developer or AI coding assistant. The key improvements over your original are: the partitioned vector table strategy, proper persistence for chat/files, streaming support, comprehensive error handling, and a maintainable frontend structure.