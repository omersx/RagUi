"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Eye, Loader2 } from "lucide-react";
import DropZone from "./DropZone";
import DoclingPreview from "./DoclingPreview";
import Toggle from "@/components/ui/Toggle";
import { useConfigStore } from "@/stores/configStore";
import { useViewStore } from "@/stores/viewStore";
import { uploadFile } from "@/lib/api";
import { toast } from "@/stores/toastStore";
import type { IngestResult } from "@/types";

const PROCESS_STEPS = ["Uploading…", "Parsing document…", "Chunking content…", "Embedding chunks…", "Storing vectors…"];

export default function UploadView() {
  const [stage, setStage] = useState<"idle" | "busy" | "done" | "duplicate">("idle");
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState(PROCESS_STEPS[0]);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [dupMessage, setDupMessage] = useState("");

  const payload = useConfigStore((s) => s.payload);
  const ocrEnabled = useConfigStore((s) => s.ocrEnabled);
  const embeddingModel = useConfigStore((s) => s.embeddingModel);
  const llmModel = useConfigStore((s) => s.llmModel);
  const extractEntities = useConfigStore((s) => s.extractEntities);
  const setExtractEntities = useConfigStore((s) => s.setExtractEntities);
  const setActiveView = useViewStore((s) => s.setActiveView);

  const busy = stage === "busy";

  const handleFile = async (file: File) => {
    setStage("busy");
    setProgress(0);
    setResult(null);
    setDupMessage("");

    // Cycle status labels once the raw upload has finished
    let stepIdx = 1;
    let uploaded = false;
    setStepLabel(PROCESS_STEPS[0]);
    const stepper = setInterval(() => {
      if (!uploaded) return;
      setStepLabel(PROCESS_STEPS[stepIdx]);
      stepIdx = Math.min(stepIdx + 1, PROCESS_STEPS.length - 1);
    }, 2500);

    try {
      const res = await uploadFile({
        file,
        config: payload(),
        ocrEnabled,
        extractEntities,
        onProgress: (p) => {
          setProgress(p);
          if (p >= 100) {
            uploaded = true;
            setStepLabel(PROCESS_STEPS[1]);
          }
        },
      });
      setResult(res);
      setStage("done");
      toast("success", `Ingested "${res.filename}" — ${res.total_chunks} chunks embedded.`);
      if (res.entity_extraction === "started") {
        toast("info", "Entity extraction running in the background — check the Knowledge Base soon.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      if (msg.startsWith("Duplicate")) {
        setDupMessage(msg);
        setStage("duplicate");
      } else {
        toast("error", msg);
        setStage("idle");
      }
    } finally {
      clearInterval(stepper);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8">
        <h1 className="text-lg font-semibold text-zinc-100">Upload Documents</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Parsed with Docling, chunked contextually, embedded with{" "}
          <span className="font-medium text-zinc-400">{embeddingModel}</span>.
        </p>
      </header>

      {stage !== "done" && (
        <DropZone disabled={busy} onFileSelected={handleFile} />
      )}

      {/* Extraction options */}
      {stage !== "done" && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-900 bg-zinc-900/40 px-4 py-3.5">
          <Toggle
            checked={extractEntities}
            onChange={setExtractEntities}
            disabled={busy}
            label="Extract entities and relations"
          />
          <div>
            <p className="text-[13px] font-medium text-zinc-200">Extract knowledge graph</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Finds people, organizations, concepts and their relations with{" "}
              <span className="font-mono text-zinc-400">{llmModel}</span> after ingest.
              Runs in the background; uses extra LLM calls.
            </p>
          </div>
        </div>
      )}

      {/* Progress */}
      {busy && (
        <div className="mt-6 animate-fade-in rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-2.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-medium text-zinc-300">
              <Loader2 size={13} className="animate-spin text-zinc-500" />
              {progress >= 100 ? stepLabel : `Uploading… ${progress}%`}
            </span>
            <span className="text-zinc-600">{progress >= 100 ? "" : `${progress}%`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-100 transition-all duration-300"
              style={{ width: progress >= 100 ? "100%" : `${progress}%` }}
            />
          </div>
          {progress >= 100 && (
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
              Server is parsing and embedding — large documents may take a moment.
            </p>
          )}
        </div>
      )}

      {/* Duplicate */}
      {stage === "duplicate" && (
        <div className="mt-6 flex items-start gap-3 animate-fade-in rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-amber-200">Already ingested</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{dupMessage}</p>
          </div>
          <button
            onClick={() => setActiveView("knowledge")}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            <Eye size={12} /> View Knowledge Base <ArrowRight size={11} />
          </button>
        </div>
      )}

      {/* Result preview */}
      {stage === "done" && result && (
        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Ingestion Preview</h2>
            <button
              onClick={() => {
                setResult(null);
                setStage("idle");
                setProgress(0);
              }}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
              Upload another
            </button>
          </div>
          <DoclingPreview result={result} />
        </div>
      )}
    </main>
  );
}
