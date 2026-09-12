"use client";

import { useState } from "react";
import { FileText, Waypoints } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useGraphStore } from "@/stores/graphStore";
import { useViewStore } from "@/stores/viewStore";
import type { ChunkSource } from "@/types";

interface SourceChipProps {
  index: number;
  source: ChunkSource;
}

export default function SourceChip({ index, source }: SourceChipProps) {
  const [open, setOpen] = useState(false);
  const focusNode = useGraphStore((s) => s.focusNode);
  const setActiveView = useViewStore((s) => s.setActiveView);

  const viewInGraph = () => {
    setOpen(false);
    focusNode(`c${source.id}`);
    setActiveView("knowledge");
  };

  const pages = source.page_range?.length
    ? source.page_range.length > 1
      ? `p.${source.page_range[0]}-${source.page_range[source.page_range.length - 1]}`
      : `p.${source.page_range[0]}`
    : null;
  const heading = source.heading_hierarchy?.length ? source.heading_hierarchy.join(" › ") : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/70 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <FileText size={11} className="shrink-0 text-zinc-500" />
        <span className="truncate">
          Source {index}
          {pages ? ` · ${pages}` : ""}
        </span>
        {typeof source.similarity === "number" && (
          <span className="shrink-0 text-zinc-500">{Math.round(source.similarity * 100)}%</span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={heading ?? `Source ${index}`}>
        <div className="space-y-3">
          {source.page_range?.length ? (
            <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400">
              <span className="rounded-md bg-zinc-800 px-2 py-1">
                Pages: {source.page_range.join(", ")}
              </span>
              <span className="rounded-md bg-zinc-800 px-2 py-1">Chunk #{source.id}</span>
              {typeof source.token_count === "number" && (
                <span className="rounded-md bg-zinc-800 px-2 py-1">{source.token_count} tokens</span>
              )}
            </div>
          ) : null}
          <div className="rounded-xl bg-zinc-950 p-4 text-[13px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {source.content}
          </div>
          <button
            onClick={viewInGraph}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-teal-900/60 hover:text-teal-300"
          >
            <Waypoints size={13} /> View chunk in knowledge graph
          </button>
        </div>
      </Modal>
    </>
  );
}
