export type Provider = "local" | "api" | "custom";

export type RetrievalMode = "semantic" | "hybrid" | "fulltext";

export interface ChatConfigPayload {
  llm_provider: Provider;
  llm_model: string;
  llm_base_url: string;
  embedding_provider: Provider;
  embedding_model: string;
  embedding_base_url: string;
  embedding_dimensions: number;
  api_key: string;
  top_k: number;
  temperature: number;
  max_tokens: number;
  retrieval_mode: RetrievalMode;
  fulltext_weight: number;
  semantic_weight: number;
  rrf_k: number;
}

export interface ChunkSource {
  id: number;
  content: string;
  page_range?: number[] | null;
  heading_hierarchy?: string[] | null;
  token_count?: number | null;
  similarity?: number | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChunkSource[];
  createdAt: number;
}

export type SSEEvent =
  | { type: "session"; session_id: string; title?: string }
  | { type: "sources"; chunks: ChunkSource[] }
  | { type: "token"; content: string }
  | { type: "title"; title: string }
  | { type: "error"; message: string }
  | { type: "done"; full_response: string };

export interface SessionSummary {
  id: string;
  title: string;
  embedding_model: string;
  llm_model: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  retrieved_chunk_ids: number[];
  created_at: string;
}

export interface FileRecord {
  id: number;
  filename: string;
  status: "processing" | "completed" | "failed";
  total_chunks: number;
  embedding_model: string | null;
  file_size_bytes: number | null;
  mime_type?: string | null;
  error_message?: string | null;
  created_at: string;
}

export interface ModelUsage {
  model: string;
  chunk_count: number;
  file_count: number;
}

export interface KnowledgeStats {
  total_files: number;
  total_chunks: number;
  models_used: ModelUsage[];
  total_storage_mb: number;
}

export interface HealthStatus {
  status: string;
  database: string;
  ollama: "available" | "unavailable";
  ollama_models?: string[];
  loaded_models?: string[];
}

export interface IngestResult {
  status: "success";
  file_id: number;
  filename: string;
  raw_markdown: string;
  chunks: ChunkSource[];
  total_chunks: number;
  embedding_model: string;
  processing_time_seconds: number;
}

export interface UploadStage {
  key: "uploading" | "parsing" | "chunking" | "embedding" | "storing";
  label: string;
}
