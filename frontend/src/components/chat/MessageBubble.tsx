"use client";

import { useState } from "react";
import { Check, Copy, User, Sparkles } from "lucide-react";
import Markdown from "./Markdown";
import SourceChip from "./SourceChip";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
}

export default function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className={`group flex w-full gap-3 animate-fade-in-up ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400">
          <Sparkles size={13} />
        </div>
      )}

      <div className={`flex max-w-[85%] flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
        {/* Bubble */}
        <div
          className={`relative rounded-2xl px-4 py-3 ${
            isUser
              ? "rounded-br-md bg-zinc-800 text-[13.5px] leading-relaxed whitespace-pre-wrap"
              : "rounded-bl-md border border-zinc-800/70 bg-zinc-900"
          }`}
        >
          {isUser ? message.content : <Markdown content={message.content} />}
          {streaming && !isUser && <span className="stream-cursor" aria-hidden />}

          {/* Source chips */}
          {!isUser && message.sources?.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-zinc-800/80 pt-2.5">
              {message.sources.map((s, i) => (
                <SourceChip key={`${s.id}-${i}`} index={i + 1} source={s} />
              ))}
            </div>
          ) : null}
        </div>

        {/* Copy action — always visible on touch devices (no hover there) */}
        {!streaming && message.content && (
          <button
            onClick={onCopy}
            className="flex items-center gap-1 px-1 text-[10.5px] font-medium text-zinc-600 transition-all duration-150 hover:text-zinc-300 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label="Copy message"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-500" /> Copied
              </>
            ) : (
              <>
                <Copy size={11} /> Copy
              </>
            )}
          </button>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
          <User size={13} />
        </div>
      )}
    </div>
  );
}
