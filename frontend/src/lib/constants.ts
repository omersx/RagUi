import type { Provider, RetrievalMode } from "@/types";

export const RETRIEVAL_MODES: {
  value: RetrievalMode;
  label: string;
  description: string;
}[] = [
  {
    value: "hybrid",
    label: "Hybrid",
    description:
      "Keyword + vector search fused with Reciprocal Rank Fusion — best overall recall.",
  },
  {
    value: "semantic",
    label: "Semantic",
    description: "Vector similarity only — finds meaning, may miss exact terms.",
  },
  {
    value: "fulltext",
    label: "Keyword (BM25)",
    description: "Postgres full-text search only — exact word matches, no embeddings.",
  },
];

export const LOCAL_EMBEDDING_MODELS = [
  { id: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2", dims: 384, hint: "Fast, lightweight" },
  { id: "all-mpnet-base-v2", label: "all-mpnet-base-v2", dims: 768, hint: "Higher quality" },
  { id: "bge-small-en-v1.5", label: "bge-small-en-v1.5", dims: 384, hint: "Strong for English" },
] as const;

export const API_EMBEDDING_MODELS = [
  { id: "text-embedding-3-small", label: "text-embedding-3-small", dims: 1536, hint: "OpenAI" },
  { id: "text-embedding-3-large", label: "text-embedding-3-large", dims: 3072, hint: "OpenAI" },
  { id: "text-embedding-ada-002", label: "text-embedding-ada-002", dims: 1536, hint: "Legacy OpenAI" },
] as const;

export const LOCAL_LLM_MODELS = ["llama3.2", "llama3.1", "mistral", "phi3", "gemma2", "qwen2.5"];

export const API_LLM_MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

// Popular OpenAI-compatible endpoints for the Custom provider option
export const CLOUD_PRESETS = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", hint: "Huge model catalog, chat only" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", hint: "Very fast inference" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", hint: "Chat + embeddings" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", hint: "Chat + embeddings" },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", hint: "Chat + embeddings" },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", hint: "Local OpenAI-compatible server" },
] as const;

export function modelsFor(provider: Provider) {
  return provider === "local"
    ? LOCAL_EMBEDDING_MODELS.map((m) => m.id)
    : API_EMBEDDING_MODELS.map((m) => m.id);
}

export const MAX_UPLOAD_MB = 50;

export const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".html", ".htm", ".pptx", ".md"];

export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.join(",");

export const SUGGESTED_PROMPTS = [
  {
    title: "Summarize a document",
    text: "Summarize the key points of my uploaded documents.",
  },
  {
    title: "Find specifics",
    text: "What dates, numbers or names are mentioned in my documents?",
  },
  {
    title: "Compare sources",
    text: "Compare the topics covered across my indexed files.",
  },
];
