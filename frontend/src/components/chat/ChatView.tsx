"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Database, Search, Sparkles, Zap } from "lucide-react";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import { useChatStore } from "@/stores/chatStore";
import { useConfigStore } from "@/stores/configStore";
import { useViewStore } from "@/stores/viewStore";
import { toast } from "@/stores/toastStore";
import { getSessionMessages, streamChat } from "@/lib/api";
import { SUGGESTED_PROMPTS } from "@/lib/constants";
import type { ChunkSource } from "@/types";

export default function ChatView() {
  const {
    sessionId,
    title,
    messages,
    isStreaming,
    loadRequest,
    pendingPrompt,
    setSessionId,
    setTitle,
    setPendingPrompt,
    addMessage,
    appendToLastAssistant,
    attachSources,
    setStreaming,
    resetChat,
    clearLoadRequest,
  } = useChatStore();

  const configPayload = useConfigStore((s) => s.payload);
  const llmProvider = useConfigStore((s) => s.llmProvider);
  const llmModel = useConfigStore((s) => s.llmModel);
  const embeddingModel = useConfigStore((s) => s.embeddingModel);
  const retrievalMode = useConfigStore((s) => s.retrievalMode);

  const setActiveView = useViewStore((s) => s.setActiveView);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [nearBottom, setNearBottom] = useState(true);

  // ---- Auto-scroll ----
  useEffect(() => {
    if (nearBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, nearBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  // ---- Load a past session (requested by HistoryPanel) ----
  useEffect(() => {
    if (!loadRequest || isStreaming) return;
    getSessionMessages(loadRequest.id)
      .then((stored) => {
        resetChat();
        setTitle(loadRequest.title);
        stored.forEach((m) =>
          addMessage({ role: m.role === "user" ? "user" : "assistant", content: m.content })
        );
        setSessionId(loadRequest.id);
        setNearBottom(true);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        });
      })
      .catch((e) => toast("error", `Failed to load session: ${e.message}`))
      .finally(() => clearLoadRequest());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest]);

  // ---- Streaming send ----
  const handleSend = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      addMessage({ role: "user", content: text });
      addMessage({ role: "assistant", content: "" }); // placeholder for tokens
      setStreaming(true);
      setNearBottom(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let sawError = false;

      try {
        for await (const ev of streamChat({
          sessionId,
          messages: [{ role: "user", content: text }],
          config: configPayload(),
          signal: controller.signal,
        })) {
          switch (ev.type) {
            case "session":
              setSessionId(ev.session_id);
              break;
            case "sources":
              attachSources(ev.chunks as ChunkSource[]);
              break;
            case "token":
              appendToLastAssistant(ev.content);
              break;
            case "title":
              setTitle(ev.title);
              break;
            case "error":
              sawError = true;
              toast("error", ev.message);
              break;
            case "done":
              break;
          }
        }
      } catch (err: unknown) {
        const aborted =
          err instanceof DOMException &&
          (err.name === "AbortError" || err.name === "TimeoutError");
        if (!aborted && !sawError) {
          toast("error", err instanceof Error ? err.message : "Chat request failed.");
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      isStreaming,
      sessionId,
      addMessage,
      appendToLastAssistant,
      attachSources,
      setSessionId,
      setStreaming,
      setTitle,
      configPayload,
    ]
  );

  const handleStop = () => abortRef.current?.abort();

  // ---- Graph handoff ("Ask chat about this chunk") ----
  useEffect(() => {
    if (!pendingPrompt || isStreaming) return;
    const prompt = pendingPrompt;
    setPendingPrompt(null);
    handleSend(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  return (
    <div className="flex h-dvh flex-1 flex-col bg-zinc-950 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate text-sm font-semibold text-zinc-200">{title}</h1>
          {messages.length > 0 && (
            <button
              onClick={() => resetChat()}
              className="shrink-0 whitespace-nowrap text-[11px] font-medium text-zinc-600 transition-colors hover:text-zinc-300"
            >
              + New chat
            </button>
          )}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10.5px] font-medium text-zinc-400">
            <Zap size={10} className={llmProvider === "local" ? "text-emerald-500" : "text-blue-400"} />
            {llmModel}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10.5px] font-medium text-zinc-400">
            <Search size={10} className={retrievalMode === "fulltext" ? "text-amber-400" : retrievalMode === "graph" ? "text-violet-400" : "text-emerald-400"} />
            {retrievalMode === "hybrid" ? "hybrid" : retrievalMode === "fulltext" ? "keyword" : retrievalMode === "graph" ? "graph" : "semantic"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10.5px] font-medium text-zinc-400">
            <Database size={10} className="text-zinc-500" />
            {embeddingModel}
          </span>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-4 pb-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="RagUi"
              className="mb-4 h-24 w-auto rounded-xl mix-blend-screen animate-fade-in"
              draggable={false}
            />
            <p className="mb-8 text-sm text-zinc-500">Chat with your documents. Ask anything.</p>
            <div className="grid w-full gap-2.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p.title}
                  onClick={() => handleSend(p.text)}
                  className="group flex items-start gap-3 rounded-xl border border-zinc-900 bg-zinc-900/40 px-4 py-3.5 text-left transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <Sparkles size={15} className="mt-0.5 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                  <span>
                    <span className="block text-[13px] font-medium text-zinc-300">{p.title}</span>
                    <span className="block text-xs text-zinc-600">{p.text}</span>
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setActiveView("upload")}
              className="mt-6 text-xs font-medium text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-300"
            >
              Upload documents to get started →
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={isStreaming && i === messages.length - 1 && m.role === "assistant"}
              />
            ))}
          </div>
        )}

        {/* Scroll to bottom */}
        {!nearBottom && messages.length > 0 && (
          <button
            onClick={() => {
              setNearBottom(true);
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            aria-label="Scroll to bottom"
            className="sticky bottom-4 left-full mr-4 -translate-x-0 rounded-full border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 shadow-lg transition-colors hover:text-white sm:mr-6"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} onStop={handleStop} disabled={false} streaming={isStreaming} />
    </div>
  );
}
