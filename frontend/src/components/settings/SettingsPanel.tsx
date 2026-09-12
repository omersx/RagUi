"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CircleAlert,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import Toggle from "@/components/ui/Toggle";
import { getHealth, testApiKey } from "@/lib/api";
import {
  API_EMBEDDING_MODELS,
  API_LLM_MODELS,
  CLOUD_PRESETS,
  LOCAL_EMBEDDING_MODELS,
  LOCAL_LLM_MODELS,
  RETRIEVAL_MODES,
} from "@/lib/constants";
import { useConfigStore } from "@/stores/configStore";
import { toast } from "@/stores/toastStore";
import type { HealthStatus, Provider, RetrievalMode } from "@/types";

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-900 bg-zinc-900/30">
      <header className="flex items-center gap-2 border-b border-zinc-900 px-5 py-3.5">
        <span className="text-zinc-500">{icon}</span>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode; disabled?: boolean }[];
}) {
  return (
    <div className="w-fit max-w-full overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1">
      <div className="flex w-max gap-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => !o.disabled && onChange(o.value)}
            disabled={o.disabled}
            title={o.disabled ? "Unavailable — service offline" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 sm:px-3 ${
              value === o.value
                ? "bg-zinc-800 text-white shadow-sm"
                : o.disabled
                  ? "cursor-not-allowed text-zinc-700"
                  : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-300">
          {label}
          {hint && <span className="ml-2 font-normal text-zinc-600">{hint}</span>}
        </label>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-[11px] tabular-nums text-zinc-300">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-zinc-100
          [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-100
          [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-110"
      />
    </div>
  );
}

const inputCls =
  // 16px on mobile prevents iOS Safari's focus auto-zoom
  "w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-[16px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-zinc-600 sm:text-xs";

// ---------- Custom-provider fields (base URL + presets) ----------

function CustomEndpointFields({
  baseUrl,
  onBaseUrlChange,
  placeholder,
}: {
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2.5 rounded-xl bg-zinc-950/60 p-3.5 animate-fade-in">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">API base URL</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={`${inputCls} font-mono`}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CLOUD_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onBaseUrlChange(p.baseUrl)}
            title={`${p.baseUrl} — ${p.hint}`}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
              baseUrl === p.baseUrl
                ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">Model name</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`${inputCls} font-mono`}
      />
    </div>
  );
}

// ---------- Key row with Test ----------

function KeyRow({
  label,
  hint,
  keyValue,
  testUrl,
  onChange,
}: {
  label: string;
  hint?: string;
  keyValue: string;
  testUrl: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; message: string } | null>(null);

  useEffect(() => setResult(null), [keyValue, testUrl]);

  const runTest = async () => {
    if (!keyValue.trim()) {
      toast("error", "Enter an API key first.");
      return;
    }
    setTesting(true);
    try {
      setResult(await testApiKey(keyValue.trim(), testUrl.trim()));
    } catch (err) {
      setResult({ valid: false, message: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            value={keyValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            aria-label={label}
            className={`w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-3.5 pr-10 font-mono text-[16px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-zinc-600 sm:text-xs`}
          />
          <button
            onClick={() => setShow(!show)}
            aria-label={show ? "Hide key" : "Show key"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-600 hover:text-zinc-300"
          >
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button
          onClick={runTest}
          disabled={testing || !keyValue.trim()}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-800 px-4 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 disabled:opacity-50"
        >
          {testing && <Loader2 size={12} className="animate-spin" />}
          Test
        </button>
      </div>
      {result && (
        <p className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${result.valid ? "text-emerald-400" : "text-red-400"}`}>
          {result.valid ? <BadgeCheck size={12} className="mt-0.5 shrink-0" /> : <XCircle size={12} className="mt-0.5 shrink-0" />}
          {result.message}
        </p>
      )}
      {hint && <p className="text-[10.5px] leading-relaxed text-zinc-600">{hint}</p>}
    </div>
  );
}

export default function SettingsPanel() {
  const cfg = useConfigStore();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getHealth());
    } catch {
      setHealth({ status: "unreachable", database: "unavailable", ollama: "unavailable" });
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 15000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  const ollamaUp = health?.ollama === "available";
  const usesApi = cfg.embeddingProvider === "api" || cfg.llmProvider === "api";
  const usesCustom = cfg.embeddingProvider === "custom" || cfg.llmProvider === "custom";

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Switch providers and models without restarting. Saved locally.
        </p>
      </header>

      {/* Embedding */}
      <Section icon={<SlidersHorizontal size={13} />} title="Embedding model">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Provider</label>
          <Segmented<Provider>
            value={cfg.embeddingProvider}
            onChange={(p) => cfg.setEmbeddingProvider(p)}
            options={[
              { value: "local", label: "Local", icon: <Cpu size={11} /> },
              { value: "api", label: "OpenAI API", icon: <Globe size={11} /> },
              { value: "custom", label: "Custom", icon: <PlugZap size={11} /> },
            ]}
          />
        </div>

        {cfg.embeddingProvider !== "custom" ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Model</label>
            <select
              value={cfg.embeddingModel}
              onChange={(e) => cfg.setEmbeddingModel(e.target.value)}
              className={inputCls}
            >
              {(cfg.embeddingProvider === "local" ? LOCAL_EMBEDDING_MODELS : API_EMBEDDING_MODELS).map(
                (m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.dims} dims{m.hint ? ` · ${m.hint}` : ""}
                  </option>
                )
              )}
            </select>
          </div>
        ) : (
          <>
            <ModelInput
              value={cfg.embeddingModel}
              onChange={cfg.setEmbeddingModel}
              placeholder='e.g. "BAAI/bge-m3" or "nomic-ai/nomic-embed-text-v1.5"'
            />
            <CustomEndpointFields
              baseUrl={cfg.embeddingBaseUrl}
              onBaseUrlChange={cfg.setEmbeddingBaseUrl}
              placeholder="https://api.together.xyz/v1"
            />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Vector dimensions{" "}
                <span className="font-normal text-zinc-600">(optional — auto-detected on first use)</span>
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                value={cfg.embeddingDimensions || ""}
                onChange={(e) => cfg.setEmbeddingDimensions(Number(e.target.value) || 0)}
                placeholder="Auto"
                className={`${inputCls} w-36 tabular-nums`}
              />
            </div>
            <p className="text-[10.5px] leading-relaxed text-zinc-600">
              The provider must expose an OpenAI-compatible <span className="font-mono">/embeddings</span>{" "}
              endpoint. Each custom model gets its own vector table.
            </p>
          </>
        )}

        {!ollamaUp && cfg.embeddingProvider === "local" && (
          <p className="flex items-center gap-1.5 text-[10.5px] text-amber-500/90">
            <AlertTriangle size={11} />
            Ollama is unreachable — local generation won&apos;t work until it&apos;s online.
          </p>
        )}
      </Section>

      {/* LLM */}
      <Section icon={<PlugZap size={13} />} title="LLM (generation)">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Provider</label>
          <Segmented<Provider>
            value={cfg.llmProvider}
            onChange={(p) => cfg.setLlmProvider(p)}
            options={[
              { value: "local", label: `Local${ollamaUp ? "" : " (offline)"}`, icon: <Cpu size={11} /> },
              { value: "api", label: "OpenAI API", icon: <Globe size={11} /> },
              { value: "custom", label: "Custom", icon: <PlugZap size={11} /> },
            ]}
          />
        </div>

        {cfg.llmProvider === "local" ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Model</label>
            <select
              value={cfg.llmModel}
              onChange={(e) => cfg.setLlmModel(e.target.value)}
              disabled={!ollamaUp}
              title={!ollamaUp ? "Ollama is offline" : undefined}
              className={`${inputCls} ${!ollamaUp ? "cursor-not-allowed opacity-60" : ""}`}
            >
              {(health?.ollama_models?.length
                ? health.ollama_models.map((m) => m.split(":")[0])
                : LOCAL_LLM_MODELS
              )
                .filter((m, i, arr) => arr.indexOf(m) === i)
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {!ollamaUp ? " (Ollama offline)" : ""}
                  </option>
                ))}
            </select>
          </div>
        ) : cfg.llmProvider === "api" ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Model</label>
            <select
              value={API_LLM_MODELS.some((m) => m.id === cfg.llmModel) ? cfg.llmModel : "gpt-4o-mini"}
              onChange={(e) => cfg.setLlmModel(e.target.value)}
              className={inputCls}
            >
              {API_LLM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <ModelInput
              value={cfg.llmModel}
              onChange={cfg.setLlmModel}
              placeholder='e.g. "anthropic/claude-3.5-sonnet" or "meta-llama/llama-3.2-3b-instruct:free"'
            />
            <CustomEndpointFields
              baseUrl={cfg.llmBaseUrl}
              onBaseUrlChange={cfg.setLlmBaseUrl}
              placeholder="https://openrouter.ai/api/v1"
            />
          </>
        )}
      </Section>

      {/* API keys */}
      <Section icon={<BadgeCheck size={13} />} title="API keys">
        {usesApi && (
          <div className={usesCustom ? "rounded-xl border border-zinc-900 bg-zinc-950/40 p-3.5" : ""}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Globe size={11} className="text-zinc-500" /> OpenAI
            </p>
            <KeyRow
              label="OpenAI API key"
              keyValue={cfg.openaiKey}
              testUrl=""
              onChange={cfg.setOpenaiKey}
              hint="Used by sections whose provider is set to OpenAI API."
            />
          </div>
        )}
        {usesCustom && (
          <div className={usesApi ? "rounded-xl border border-zinc-900 bg-zinc-950/40 p-3.5" : ""}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <PlugZap size={11} className="text-zinc-500" /> Custom endpoints
            </p>
            <KeyRow
              label="Custom provider API key"
              keyValue={cfg.customLlmKey}
              testUrl={cfg.llmProvider === "custom" ? cfg.llmBaseUrl : cfg.embeddingBaseUrl}
              onChange={cfg.setCustomLlmKey}
              hint="Sent as a Bearer token to whichever Custom endpoint is configured above."
            />
          </div>
        )}
        {!usesApi && !usesCustom && (
          <p className="text-[11px] leading-relaxed text-zinc-600">
            No cloud providers selected — running fully local.
          </p>
        )}
        <p className="text-[10.5px] leading-relaxed text-zinc-600">
          Keys are stored in your browser only — sent to the backend per request, never persisted server-side.
        </p>
      </Section>

      {/* Connection security */}
      <Section icon={<ShieldCheck size={13} />} title="Connection">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">
            Access token{" "}
            <span className="font-normal text-zinc-600">(only if the server sets API_AUTH_TOKEN)</span>
          </label>
          <input
            type="password"
            value={cfg.authToken}
            onChange={(e) => cfg.setAuthToken(e.target.value)}
            placeholder="Leave empty for unauthenticated servers"
            autoComplete="off"
            aria-label="API access token"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-2 text-[10.5px] leading-relaxed text-zinc-600">
            Sent as a Bearer token with every request. Stored in this browser only.
          </p>
        </div>
      </Section>

      {/* Retrieval mode */}
      <Section icon={<SlidersHorizontal size={13} />} title="Retrieval">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-400">Search mode</label>
          <Segmented<RetrievalMode>
            value={cfg.retrievalMode}
            onChange={(m) => cfg.setRetrievalMode(m)}
            options={RETRIEVAL_MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
          <p className="mt-2 text-[10.5px] leading-relaxed text-zinc-600">
            {RETRIEVAL_MODES.find((m) => m.value === cfg.retrievalMode)?.description}
          </p>
        </div>

        {cfg.retrievalMode === "hybrid" && (
          <div className="space-y-4 rounded-xl bg-zinc-950/60 p-3.5 animate-fade-in">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Reciprocal Rank Fusion (RRF)
            </p>
            <SliderRow
              label="Keyword weight"
              hint="full-text list"
              min={0}
              max={3}
              step={0.1}
              value={cfg.fulltextWeight}
              format={(v) => v.toFixed(1)}
              onChange={cfg.setFulltextWeight}
            />
            <SliderRow
              label="Semantic weight"
              hint="vector list"
              min={0}
              max={3}
              step={0.1}
              value={cfg.semanticWeight}
              format={(v) => v.toFixed(1)}
              onChange={cfg.setSemanticWeight}
            />
            <SliderRow
              label="Smoothing constant k"
              hint="higher = gentler rank falloff"
              min={1}
              max={100}
              step={1}
              value={cfg.rrfK}
              onChange={cfg.setRrfK}
            />
          </div>
        )}

        {cfg.retrievalMode === "fulltext" && (
          <p className="rounded-lg border border-amber-950/50 bg-amber-950/20 px-3 py-2 text-[10.5px] leading-relaxed text-amber-300/80 animate-fade-in">
            Keyword-only search skips embeddings entirely — queries match exact word stems, so
            paraphrases won&apos;t be found.
          </p>
        )}

        {cfg.retrievalMode === "graph" && (
          <div className="space-y-3 rounded-xl bg-zinc-950/60 p-3.5 animate-fade-in">
            <p className="text-[10.5px] leading-relaxed text-zinc-500">
              Matches entities named in your question, walks their relations, and grounds the
              answer in those chunks. Requires extracted entities — otherwise it falls back to
              hybrid automatically.
            </p>
            {health?.entities && (health.entities.running > 0 || health.entities.queued > 0 || health.entities.processing > 0) && (
              <p className="text-[10.5px] text-amber-400/90">
                Background extractions: {health.entities.running} running ·{" "}
                {health.entities.queued} queued · {health.entities.processing} active in DB.
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-400">Hop depth</span>
              <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
                {[1, 2].map((d) => (
                  <button
                    key={d}
                    onClick={() => cfg.setGraphDepth(d)}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${cfg.graphDepth === d ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                    title={d === 1 ? "Direct relations only" : "Relations of relations too"}
                  >
                    {d} hop{d === 2 ? "s" : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Advanced */}
      <Section icon={<Cpu size={13} />} title="Advanced">
        <SliderRow
          label="Top-K results"
          hint="chunks retrieved per question"
          min={1}
          max={20}
          step={1}
          value={cfg.topK}
          onChange={cfg.setTopK}
        />
        <SliderRow
          label="Temperature"
          hint="higher = more creative"
          min={0}
          max={1.5}
          step={0.05}
          value={cfg.temperature}
          format={(v) => v.toFixed(2)}
          onChange={cfg.setTemperature}
        />
        <div className="flex items-center justify-between pt-1">
          <div>
            <label className="text-xs font-medium text-zinc-300">Enable OCR</label>
            <p className="mt-0.5 text-[10.5px] text-zinc-600">
              Extract text from scanned PDFs (slower)
            </p>
          </div>
          <Toggle checked={cfg.ocrEnabled} onChange={cfg.setOcrEnabled} label="Enable OCR" />
        </div>
      </Section>

      {/* System status */}
      <Section icon={<PlugZap size={13} />} title="System status">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between rounded-xl bg-zinc-950 px-3.5 py-3">
            <span className="flex items-center gap-2.5 text-xs font-medium text-zinc-200">
              <span
                className={`h-2 w-2 rounded-full ${
                  health === null
                    ? "bg-zinc-600 animate-pulse"
                    : health.database === "connected"
                      ? "bg-emerald-500"
                      : "bg-red-500"
                }`}
              />
              PostgreSQL database
            </span>
            <span className="font-mono text-[10.5px] text-zinc-500">{health?.database ?? "checking…"}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-zinc-950 px-3.5 py-3">
            <span className="flex items-center gap-2.5 text-xs font-medium text-zinc-200">
              <span
                className={`h-2 w-2 rounded-full ${
                  health === null
                    ? "animate-pulse bg-zinc-600"
                    : ollamaUp
                      ? "bg-emerald-500"
                      : "bg-red-500"
                }`}
              />
              Ollama
              {health?.ollama === "unavailable" && <CircleAlert size={11} className="text-red-500" />}
            </span>
            <span className="font-mono text-[10.5px] text-zinc-500">
              {health === null ? "checking…" : ollamaUp ? "localhost:11434" : "offline"}
            </span>
          </div>
          {ollamaUp && (
            <p className="px-1 text-[10.5px] text-zinc-600">
              Available models:{" "}
              <span className="font-mono text-zinc-500">
                {health?.ollama_models?.length ? health.ollama_models.join(", ") : "none pulled yet"}
              </span>
            </p>
          )}
        </div>
      </Section>

      {health && health.status !== "healthy" && health.status !== "degraded" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-950/60 bg-red-950/20 p-4 animate-fade-in">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-400" />
          <p className="text-[11px] leading-relaxed text-red-300/90">
            Backend reports <span className="font-semibold">{health.status}</span> — check that the
            FastAPI server and Docker Postgres container are running.
          </p>
        </div>
      )}
    </main>
  );
}
