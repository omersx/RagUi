"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore, type ToastKind } from "@/stores/toastStore";

const ICONS: Record<ToastKind, JSX.Element> = {
  success: <CheckCircle2 size={16} className="text-emerald-400" />,
  error: <AlertCircle size={16} className="text-red-400" />,
  info: <Info size={16} className="text-zinc-400" />,
};

export default function Toasts() {
  const { toasts, dismiss } = useToastStore();
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/95 px-4 py-3 shadow-xl backdrop-blur animate-fade-in-up"
        >
          <span className="mt-0.5 shrink-0">{ICONS[t.kind]}</span>
          <p className="flex-1 break-words text-xs leading-relaxed text-zinc-200">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-0.5 text-zinc-600 transition-colors hover:text-zinc-300"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
