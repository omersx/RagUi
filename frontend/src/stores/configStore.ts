import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatConfigPayload, Provider, RetrievalMode } from "@/types";

interface ConfigState {
  authToken: string;
  llmProvider: Provider;
  llmModel: string;
  llmBaseUrl: string;
  customLlmKey: string;
  embeddingProvider: Provider;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingDimensions: number;
  openaiKey: string;
  topK: number;
  temperature: number;
  maxTokens: number;
  ocrEnabled: boolean;
  retrievalMode: RetrievalMode;
  fulltextWeight: number;
  semanticWeight: number;
  rrfK: number;

  setAuthToken: (t: string) => void;
  setLlmProvider: (p: Provider) => void;
  setLlmModel: (m: string) => void;
  setLlmBaseUrl: (u: string) => void;
  setCustomLlmKey: (k: string) => void;
  setEmbeddingProvider: (p: Provider) => void;
  setEmbeddingModel: (m: string) => void;
  setEmbeddingBaseUrl: (u: string) => void;
  setEmbeddingDimensions: (n: number) => void;
  setOpenaiKey: (k: string) => void;
  setTopK: (n: number) => void;
  setTemperature: (n: number) => void;
  setMaxTokens: (n: number) => void;
  setOcrEnabled: (b: boolean) => void;
  setRetrievalMode: (m: RetrievalMode) => void;
  setFulltextWeight: (n: number) => void;
  setSemanticWeight: (n: number) => void;
  setRrfK: (n: number) => void;

  payload: () => ChatConfigPayload;
}

const KNOWN_LOCAL_EMBED = ["all-MiniLM-L6-v2", "all-mpnet-base-v2", "bge-small-en-v1.5"];
const KNOWN_API_EMBED = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
];

/** Pick the right key per request: custom key wins when a Custom provider is in play. */
function resolveApiKey(s: ConfigState): string {
  if (s.llmProvider === "custom" || s.embeddingProvider === "custom") {
    return s.customLlmKey || s.openaiKey;
  }
  return s.openaiKey;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      authToken: "",
      llmProvider: "local",
      llmModel: "llama3.2",
      llmBaseUrl: "",
      customLlmKey: "",
      embeddingProvider: "local",
      embeddingModel: "all-MiniLM-L6-v2",
      embeddingBaseUrl: "",
      embeddingDimensions: 0,
      openaiKey: "",
      topK: 5,
      temperature: 0.7,
      maxTokens: 2048,
      ocrEnabled: false,
      retrievalMode: "hybrid",
      fulltextWeight: 1.0,
      semanticWeight: 1.0,
      rrfK: 50,

      setAuthToken: (t) => set({ authToken: t }),
      setLlmProvider: (p) =>
        set((s) => {
          let model = s.llmModel.trim();
          if (p === "api" && !model.startsWith("gpt")) model = "gpt-4o-mini";
          if (p === "local" && model.startsWith("gpt")) model = "llama3.2";
          return { llmProvider: p, llmModel: model };
        }),
      setLlmModel: (m) => set({ llmModel: m }),
      setLlmBaseUrl: (u) => set({ llmBaseUrl: u }),
      setCustomLlmKey: (k) => set({ customLlmKey: k }),

      setEmbeddingProvider: (p) =>
        set((s) => {
          const model = s.embeddingModel.trim();
          let next = model;
          if (p === "local" && !KNOWN_LOCAL_EMBED.includes(model)) next = "all-MiniLM-L6-v2";
          else if (p === "api" && !KNOWN_API_EMBED.includes(model)) next = "text-embedding-3-small";
          else if (p === "custom" && (!model || KNOWN_LOCAL_EMBED.includes(model) || KNOWN_API_EMBED.includes(model)))
            next = "";
          return { embeddingProvider: p, embeddingModel: next };
        }),
      setEmbeddingModel: (m) => set({ embeddingModel: m }),
      setEmbeddingBaseUrl: (u) => set({ embeddingBaseUrl: u }),
      setEmbeddingDimensions: (n) => set({ embeddingDimensions: n }),

      setOpenaiKey: (k) => set({ openaiKey: k }),
      setTopK: (n) => set({ topK: n }),
      setTemperature: (n) => set({ temperature: n }),
      setMaxTokens: (n) => set({ maxTokens: n }),
      setOcrEnabled: (b) => set({ ocrEnabled: b }),
      setRetrievalMode: (m) => set({ retrievalMode: m }),
      setFulltextWeight: (n) => set({ fulltextWeight: n }),
      setSemanticWeight: (n) => set({ semanticWeight: n }),
      setRrfK: (n) => set({ rrfK: n }),

      payload: () => {
        const s = get();
        return {
          llm_provider: s.llmProvider,
          llm_model: s.llmModel.trim(),
          llm_base_url: s.llmBaseUrl.trim(),
          embedding_provider: s.embeddingProvider,
          embedding_model: s.embeddingModel.trim(),
          embedding_base_url: s.embeddingBaseUrl.trim(),
          embedding_dimensions: s.embeddingDimensions || 0,
          api_key: resolveApiKey(s),
          top_k: s.topK,
          temperature: s.temperature,
          max_tokens: s.maxTokens,
          retrieval_mode: s.retrievalMode,
          fulltext_weight: s.fulltextWeight,
          semantic_weight: s.semanticWeight,
          rrf_k: s.rrfK,
        };
      },
    }),
    {
      name: "ragui-config",
      version: 4,
      migrate: (persisted, version) => {
        const state = persisted as Partial<ConfigState>;
        if (version < 2) {
          Object.assign(state, {
            retrievalMode: "hybrid" as RetrievalMode,
            fulltextWeight: 1.0,
            semanticWeight: 1.0,
            rrfK: 50,
          });
        }
        if (version < 3) {
          Object.assign(state, {
            llmBaseUrl: "",
            customLlmKey: "",
            embeddingBaseUrl: "",
            embeddingDimensions: 0,
          });
        }
        if (version < 4) {
          Object.assign(state, { authToken: "" });
        }
        return state as ConfigState;
      },
    }
  )
);
