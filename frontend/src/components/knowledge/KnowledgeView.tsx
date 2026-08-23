"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Database,
  FileText,
  HardDrive,
  Layers,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { deleteKnowledgeFile, getKnowledgeFiles, getKnowledgeStats } from "@/lib/api";
import { toast } from "@/stores/toastStore";
import type { FileRecord, KnowledgeStats } from "@/types";

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-zinc-900 bg-zinc-900/40 px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-zinc-400">
        {icon}
      </div>
      <div>
        <div className="text-lg font-semibold leading-tight text-zinc-100">{value}</div>
        <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-950/50 text-emerald-400 border-emerald-900/60",
  processing: "bg-amber-950/40 text-amber-400 border-amber-900/60",
  failed: "bg-red-950/40 text-red-400 border-red-900/60",
};

export default function KnowledgeView() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<FileRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        getKnowledgeStats(),
        getKnowledgeFiles() as Promise<FileRecord[]>,
      ]);
      setStats(s);
      setFiles(f ?? []);
    } catch (err) {
      toast("error", `Failed to load knowledge base: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await deleteKnowledgeFile(confirmDelete.id);
      toast("success", `Deleted "${confirmDelete.filename}" — ${res.chunks_removed} chunks removed.`);
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Knowledge Base</h1>
          <p className="mt-1 text-sm text-zinc-500">Everything indexed and searchable right now.</p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            refresh();
          }}
          aria-label="Refresh"
          className="rounded-lg border border-zinc-800 p-2 text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      {/* Stat cards */}
      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={<FileText size={17} />} value={stats?.total_files ?? "—"} label="Files indexed" />
        <StatCard icon={<Layers size={17} />} value={stats?.total_chunks ?? "—"} label="Chunks embedded" />
        <StatCard
          icon={<HardDrive size={17} />}
          value={stats ? `${stats.total_storage_mb.toFixed(1)} MB` : "—"}
          label="Storage used"
        />
      </section>

      {/* Files table */}
      <section className="mb-8 overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900/30">
        <header className="border-b border-zinc-900 px-5 py-3.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Indexed files
          </h2>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-zinc-600">
            <Spinner /> Loading…
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14">
            <Database size={22} className="text-zinc-700" />
            <p className="text-xs text-zinc-600">No documents yet — upload one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px] md:min-w-0">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-zinc-600">
                  <th className="px-5 py-2.5 font-medium">File</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Chunks</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Model</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Added</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.id}
                    className="border-t border-zinc-900/80 transition-colors hover:bg-zinc-900/50"
                  >
                    <td className="max-w-[160px] truncate px-5 py-3 font-medium text-zinc-200 sm:max-w-[220px]" title={f.filename}>
                      {f.filename}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          STATUS_STYLES[f.status] ?? ""
                        }`}
                      >
                        {f.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-400">{f.total_chunks}</td>
                    <td className="hidden max-w-[150px] truncate px-4 py-3 text-xs text-zinc-500 md:table-cell" title={f.embedding_model ?? ""}>
                      {f.embedding_model ?? "—"}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-zinc-500 lg:table-cell">
                      {new Date(f.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setConfirmDelete(f)}
                        aria-label={`Delete ${f.filename}`}
                        className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
                      >
                        <Trash2 size={13.5} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Models in use */}
      {stats && stats.models_used.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900/30">
          <header className="border-b border-zinc-900 px-5 py-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Embedding models in use
            </h2>
          </header>
          <div className="divide-y divide-zinc-900/80">
            {stats.models_used.map((m) => (
              <div key={m.model} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="truncate font-mono text-xs text-zinc-300" title={m.model}>
                  {m.model}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {m.chunk_count.toLocaleString()} chunks · {m.file_count} file
                  {m.file_count === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Delete confirmation */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete file?">
        <p className="text-sm leading-relaxed text-zinc-400">
          This permanently removes{" "}
          <span className="font-semibold text-zinc-200">{confirmDelete?.filename}</span> and all of
          its chunks. Chat history is kept.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => setConfirmDelete(null)}
            className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg bg-red-950/70 px-3.5 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-900/70 disabled:opacity-50"
          >
            {deleting && <Spinner size={12} />} Delete
          </button>
        </div>
      </Modal>
    </main>
  );
}
