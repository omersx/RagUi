"use client";

import { MessageSquare, History, Database, Upload, Settings } from "lucide-react";
import SidebarIcon from "./SidebarIcon";
import { useViewStore, type ActiveView } from "@/stores/viewStore";
import { useChatStore } from "@/stores/chatStore";

const ITEMS: {
  view: ActiveView;
  icon: typeof MessageSquare;
  label: string;
}[] = [
  { view: "chat", icon: MessageSquare, label: "Chat" },
  { view: "history", icon: History, label: "History" },
  { view: "knowledge", icon: Database, label: "Knowledge Base" },
  { view: "upload", icon: Upload, label: "Upload Documents" },
];

export default function Sidebar() {
  const activeView = useViewStore((s) => s.activeView);
  const setActiveView = useViewStore((s) => s.setActiveView);

  const newChat = useChatStore((s) => s.resetChat);
  const messageCount = useChatStore((s) =>
    s.messages.reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0)
  );

  const onNewChat = () => {
    newChat();
    setActiveView("chat");
  };

  const chatItem = ITEMS.find((i) => i.view === "chat")!;

  return (
    <>
      {/* Desktop icon rail */}
      <aside className="hidden h-dvh w-16 shrink-0 flex-col items-center border-r border-zinc-900 bg-zinc-950 py-4 md:flex">
        {/* Logo */}
        <div className="mb-6">
          {/* mix-blend-screen drops the logo's black background into the dark theme */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="RagUi"
            className="h-9 w-auto rounded-md mix-blend-screen"
            draggable={false}
          />
        </div>

        <nav className="flex flex-col items-center gap-2">
          {/* New Chat */}
          <SidebarIcon
            icon={chatItem.icon}
            label={messageCount > 0 ? "New Chat" : chatItem.label}
            active={activeView === "chat"}
            onClick={() => (messageCount > 0 ? onNewChat() : setActiveView("chat"))}
          />
          {ITEMS.filter((i) => i.view !== "chat").map(({ view, icon, label }) => (
            <SidebarIcon
              key={view}
              icon={icon}
              label={label}
              active={activeView === view}
              onClick={() => setActiveView(view)}
            />
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings anchored bottom */}
        <SidebarIcon
          icon={Settings}
          label="Settings"
          active={activeView === "settings"}
          onClick={() => setActiveView("settings")}
        />
      </aside>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-zinc-900 bg-zinc-950/95 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
        aria-label="Primary"
      >
        {[chatItem, ...ITEMS.filter((i) => i.view !== "chat"), { view: "settings" as ActiveView, icon: Settings, label: "Settings" }].map(
          ({ view, icon: Icon, label }) => {
            const isChat = view === "chat";
            const showLabel = isChat && messageCount > 0 ? "New Chat" : label;
            return (
              <button
                key={view}
                onClick={() =>
                  isChat && messageCount > 0 ? onNewChat() : setActiveView(view)
                }
                aria-label={showLabel}
                aria-current={activeView === view ? "page" : undefined}
                className={`flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors ${
                  activeView === view ? "text-white" : "text-zinc-500 active:bg-zinc-900"
                }`}
              >
                <Icon size={19} strokeWidth={activeView === view ? 2.2 : 1.8} />
                <span className="max-w-[68px] truncate text-[9.5px] font-medium">
                  {showLabel}
                </span>
              </button>
            );
          }
        )}
      </nav>
    </>
  );
}
