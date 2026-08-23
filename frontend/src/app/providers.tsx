"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/sidebar/Sidebar";
import Toasts from "@/components/ui/Toasts";
import ChatView from "@/components/chat/ChatView";
import UploadView from "@/components/upload/UploadView";
import KnowledgeView from "@/components/knowledge/KnowledgeView";
import HistoryPanel from "@/components/history/HistoryPanel";
import SettingsPanel from "@/components/settings/SettingsPanel";
import { useViewStore } from "@/stores/viewStore";
import type { ActiveView } from "@/stores/viewStore";

function ActiveScreen() {
  const activeView = useViewStore((s) => s.activeView);
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch until stores rehydrate from localStorage
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="flex-1" />;

  // Scrollable views clear the mobile bottom tab bar (h-[56px] + safe area).
  const scrollWrap =
    "h-dvh flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0";

  const views: Record<ActiveView, JSX.Element> = {
    chat: <ChatView />,
    upload: (
      <div className={scrollWrap}>
        <UploadView />
      </div>
    ),
    history: (
      <div className={scrollWrap}>
        <HistoryPanel />
      </div>
    ),
    knowledge: (
      <div className={scrollWrap}>
        <KnowledgeView />
      </div>
    ),
    settings: (
      <div className={scrollWrap}>
        <SettingsPanel />
      </div>
    ),
  };
  return views[activeView];
}

export default function Providers() {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <ActiveScreen />
      <Toasts />
    </div>
  );
}
