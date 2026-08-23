"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { deleteSession, getSessions } from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";
import { useViewStore } from "@/stores/viewStore";
import { toast } from "@/stores/toastStore";
import type { SessionSummary } from "@/types";

function groupByDate(sessions: SessionSummary[]) {
  const groups: Record<string, SessionSummary[]> = {};
  const now = new Date();
  for (const s of sessions) {
    const d = new Date(s.updated_at);
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    let label: string;
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Yesterday";
    else if (diffDays < 7) label = "Previous 7 days";
    else if (diffDays < 30) label = "Previous 30 days";
    else label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    (groups[label] ??= []).push(s);
  }
  return Object.entries(groups);
}

export default function HistoryPanel() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<SessionSummary | null>(null);

  const requestLoad = useChatStore((s) => s.requestLoad);
  const activeSessionId = useChatStore((s) => s.sessionId);
  const setActiveView = useViewStore((s) => s.setActiveView);

  const refresh = useCallback(async () => {
    try {
      const list = await getSessions();
      setSessions(list ?? []);
    } catch (err) {
      toast("error", `Failed to load history: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteSession(confirmDelete.id);
      toast("success", `Deleted "${confirmDelete.title}".`);
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Chat History</h1>
          <p className="mt-1 text-sm text-zinc-500">Pick up any conversation where you left off.</p>
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-zinc-600">
          <Spinner /> Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-900 bg-zinc-900/30 py-16">
          <MessageSquare size={22} className="text-zinc-700" />
          <p className="text-xs text-zinc-600">No conversations yet.</p>
        </div>
      ) : (
        <div className="space-y-7">
          {groupByDate(sessions).map(([label, items]) => (
            <section key={label}>
              <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600">
                {label}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900/30 divide-y divide-zinc-900/80">
                {items.map((s) => {
                  const isActive = s.id === activeSessionId;
                  return (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-900/70 ${
                        isActive ? "bg-zinc-900/70" : ""
                      }`}
                    >
                      <button
                        onClick={() => {
                          requestLoad({ id: s.id, title: s.title });
                          setActiveView("chat");
                        }}
                        className="flex min-w-0 flex-1 flex-col items-start text-left"
                      >
                        <span
                          className={`max-w-full truncate text-[13px] font-medium ${
                            isActive ? "text-white" : "text-zinc-200"
                          }`}
                        >
                          {s.title || "New Chat"}
                        </span>
                        <span className="mt-0.5 text-[10.5px] text-zinc-600">
                          {s.message_count} messages · {new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </button>
                      <span className="hidden shrink-0 font-mono text-[9.5px] text-zinc-700 lg:block">
                        {s.llm_model}
                      </span>
                      <button
                        onClick={() => setConfirmDelete(s)}
                        aria-label={`Delete ${s.title}`}
                        className="shrink-0 rounded-lg p-1.5 text-zinc-700 transition-all hover:bg-red-950/40 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete session?">
        <p className="text-sm leading-relaxed text-zinc-400">
          This permanently removes{" "}
          <span className="font-semibold text-zinc-200">{confirmDelete?.title}</span> and all its
          messages.
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
            className="rounded-lg bg-red-950/70 px-3.5 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-900/70"
          >
            Delete
          </button>
        </div>
      </Modal>
    </main>
  );
}
