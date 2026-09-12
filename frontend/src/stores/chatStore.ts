import { create } from "zustand";
import type { ChunkSource, Message } from "@/types";

interface ChatState {
  sessionId: string | null;
  title: string;
  messages: Message[];
  isStreaming: boolean;
  /** Set by HistoryPanel to request loading a past session into the chat view */
  loadRequest: { id: string; title: string } | null;
  /** Set by KnowledgeGraph ("Ask chat about this chunk") — auto-sent by ChatView */
  pendingPrompt: string | null;

  setSessionId: (id: string | null) => void;
  setTitle: (t: string) => void;
  setPendingPrompt: (p: string | null) => void;
  addMessage: (msg: Omit<Message, "id" | "createdAt">) => Message;
  appendToLastAssistant: (token: string) => void;
  attachSources: (sources: ChunkSource[]) => void;
  setStreaming: (s: boolean) => void;
  resetChat: () => void;
  requestLoad: (req: { id: string; title: string }) => void;
  clearLoadRequest: () => void;
}

let counter = 0;
const genId = () => `m${Date.now()}_${counter++}`;

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  title: "New Chat",
  messages: [],
  isStreaming: false,
  loadRequest: null,
  pendingPrompt: null,

  setSessionId: (id) => set({ sessionId: id }),
  setTitle: (t) => set({ title: t }),

  addMessage: (msg) => {
    const full: Message = { ...msg, id: genId(), createdAt: Date.now() };
    set((s) => ({ messages: [...s.messages, full] }));
    return full;
  },

  appendToLastAssistant: (token) =>
    set((s) => {
      if (!token) return s;
      const messages = [...s.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          messages[i] = { ...messages[i], content: messages[i].content + token };
          break;
        }
      }
      return { messages };
    }),

  attachSources: (sources) =>
    set((s) => {
      if (!sources.length) return s;
      const messages = [...s.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          messages[i] = { ...messages[i], sources };
          break;
        }
      }
      return { messages };
    }),

  setStreaming: (v) => set({ isStreaming: v }),

  resetChat: () => set({ sessionId: null, title: "New Chat", messages: [], isStreaming: false }),

  requestLoad: (req) => set({ loadRequest: req }),
  clearLoadRequest: () => set({ loadRequest: null }),
  setPendingPrompt: (p) => set({ pendingPrompt: p }),
}));
