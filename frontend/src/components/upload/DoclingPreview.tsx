"use client";

import { useState } from "react";
import { Check, FileText, Hash, Layers } from "lucide-react";
import Markdown from "@/components/chat/Markdown";
import type { IngestResult, ChunkSource } from "@/types";

interface DoclingPreviewProps {
  result: IngestResult;
}

function ChunkCard({ chunk, index }: { chunk: ChunkSource; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const pages = chunk.page_range?.length
    ? chunk.page_range.length > 1
      ? `${chunk.page_range[0]}-${chunk.page_range[chunk.page_range.length - 1]}`
      : String(chunk.page_range[0])
    : "—";

  const headings = chunk.heading_hierarchy?.length
    ? chunk.heading_hierarchy.join(" › ")
    : null;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900 p-3.5 transition-colors hover:border-zinc-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
          <Layers size={11} className="text-zinc-500" />
          Chunk {index + 1}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-zinc-600">
          {headings && (
            <span className="max-w-[160px] truncate" title={headings}>
              {headings}
            </span>
          )}
          <span className="rounded bg-zinc-800 px-1.5 py-0.5">p.{pages}</span>
          {typeof chunk.token_count === "number" && (
            <span className="flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5">
              <Hash size={8} /> {chunk.token_count}
            </span>
          )}
        </span>
      </div>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <p
          className={`whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-500 ${
            expanded ? "" : "line-clamp-4"
          }`}
        >
          {chunk.content}
        </p>
      </button>
    </div>
  );
}

export default function DoclingPreview({ result }: DoclingPreviewProps) {
  return (
    <div className="animate-fade-in-up">
      {/* Summary strip */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <Check size={13} /> {result.filename}
        </span>
        <span className="text-xs text-zinc-500">{result.total_chunks} chunks</span>
        <span className="text-xs text-zinc-500">{result.embedding_model}</span>
        <span className="ml-auto text-xs text-zinc-600">
          processed in {result.processing_time_seconds}s
        </span>
      </div>

      {/* Split panel */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Markdown */}
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
          <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
            <FileText size={13} className="text-zinc-500" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Raw Markdown (Docling)
            </h3>
          </header>
          <div className="max-h-[60vh] overflow-y-auto px-4 py-4">
            <Markdown content={result.raw_markdown || "*No markdown output.*"} />
          </div>
        </section>

        {/* Chunks */}
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
          <header className="border-b border-zinc-800 px-4 py-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Chunks ({result.total_chunks})
            </h3>
          </header>
          <div className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto p-3">
            {result.chunks.map((c, i) => (
              <ChunkCard key={c.id ?? i} chunk={c} index={i} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
