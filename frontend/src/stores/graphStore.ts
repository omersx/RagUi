import { create } from "zustand";

export type KnowledgeTab = "list" | "graph";

interface GraphState {
  tab: KnowledgeTab;
  /** Chunk/file node id the graph should select + center (set from chat). */
  focusNodeId: string | null;
  setTab: (t: KnowledgeTab) => void;
  /** Switch to the graph tab and request focus on a node. */
  focusNode: (id: string) => void;
  clearFocus: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  tab: "list",
  focusNodeId: null,
  setTab: (tab) => set({ tab }),
  focusNode: (id) => set({ tab: "graph", focusNodeId: id }),
  clearFocus: () => set({ focusNodeId: null }),
}));
