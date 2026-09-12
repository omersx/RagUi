export type Provider = "local" | "api" | "custom";

export type RetrievalMode = "semantic" | "hybrid" | "fulltext" | "graph";

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
  graph_depth: number;
  graph_max_entities: number;
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
  entity_status?: "skipped" | "queued" | "processing" | "completed" | "failed";
  entity_error?: string | null;
  entity_count?: number;
  relation_count?: number;
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

export interface GraphNode {
  id: string;
  type: "file" | "chunk" | "entity";
  label: string;
  file_id?: number;
  filename?: string;
  preview?: string;
  headings?: string[];
  token_count?: number | null;
  chunk_count?: number;
  entity_type?: string;
  mention_count?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "contains" | "similar" | "relates" | "mentions";
  weight?: number;
  label?: string;
}

export type GraphLayer = "chunks" | "entities" | "both";

export interface KnowledgeGraph {
  model: string | null;
  models_available: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_chunks: number;
  returned_chunks: number;
  truncated: boolean;
  strategy?: string;
  layer?: GraphLayer;
  total_entities?: number;
  returned_entities?: number;
}

export interface HealthStatus {
  status: string;
  database: string;
  ollama: "available" | "unavailable";
  ollama_models?: string[];
  loaded_models?: string[];
  entities?: { running: number; queued: number; processing: number };
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
  entity_extraction?: "started" | "skipped";
}

export interface EntityRecord {
  id: number;
  name: string;
  type: string;
  mention_count: number;
  file_count: number;
}

export interface UploadStage {
  key: "uploading" | "parsing" | "chunking" | "embedding" | "storing";
  label: string;
}
