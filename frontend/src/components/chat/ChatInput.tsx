"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  disabled: boolean;
  streaming: boolean;
}

export default function ChatInput({ onSend, onStop, disabled, streaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) return; // Enter during stream = no-op
      submit();
    }
  };

  return (
    <div className="border-t border-zinc-900 bg-zinc-950/80 px-3 py-3 backdrop-blur sm:px-4 sm:py-4">
      <div className="mx-auto max-w-3xl">
        <div
          className={`flex items-end gap-2 rounded-[26px] border border-zinc-800 bg-zinc-800/60 py-2 pl-4 pr-2 transition-colors duration-200 focus-within:border-zinc-600 sm:pl-5 ${
            disabled ? "opacity-60" : ""
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about your documents..."
            rows={1}
            disabled={disabled}
            // 16px on mobile prevents iOS Safari's focus auto-zoom
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[16px] text-zinc-100 outline-none placeholder:text-zinc-500 sm:text-sm"
          />
          {streaming ? (
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-950 transition-transform hover:scale-105 active:scale-95"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label="Send message"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
                value.trim() && !disabled
                  ? "bg-white text-zinc-950 hover:scale-105 active:scale-95"
                  : "cursor-not-allowed bg-zinc-700 text-zinc-400"
              }`}
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
        <p className="mt-2 hidden text-center text-[10.5px] text-zinc-600 sm:block">
          Responses are grounded in your indexed documents · Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
