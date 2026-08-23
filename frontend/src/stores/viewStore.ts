import { create } from "zustand";

export type ActiveView = "chat" | "history" | "knowledge" | "upload" | "settings";

interface ViewState {
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "chat",
  setActiveView: (v) => set({ activeView: v }),
}));
