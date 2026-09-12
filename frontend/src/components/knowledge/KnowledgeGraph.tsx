"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  Crosshair,
  FileText,
  Maximize2,
  MessageSquarePlus,
  Pause,
  Play,
  Search,
  Tags,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { getKnowledgeGraph } from "@/lib/api";
import { toast } from "@/stores/toastStore";
import { useChatStore } from "@/stores/chatStore";
import { useGraphStore } from "@/stores/graphStore";
import { useViewStore } from "@/stores/viewStore";
import type { GraphLayer, GraphNode, KnowledgeGraph as GraphData } from "@/types";

/* ------------------------------------------------------------------ */
/* D3-powered knowledge graph: d3-force simulation + d3-zoom canvas.    */
/* ------------------------------------------------------------------ */

const PALETTE = [
  "#34d399", "#38bdf8", "#a78bfa", "#fbbf24", "#fb7185",
  "#22d3ee", "#a3e635", "#fb923c", "#e879f9", "#818cf8",
];
function colorForFile(fileId: number | undefined): string {
  if (fileId === undefined || fileId === null) return "#71717a";
  return PALETTE[Math.abs(fileId) % PALETTE.length];
}
function fileIdOf(n: GraphNode): number {
  if (typeof n.file_id === "number") return n.file_id;
  const m = /^f(\d+)$/.exec(n.id);
  return m ? Number(m[1]) : 0;
}

/* Entity nodes: diamond shape, colored by entity type (not by file). */
const ENTITY_COLORS: Record<string, string> = {
  person: "#38bdf8",
  organization: "#fbbf24",
  place: "#34d399",
  concept: "#a78bfa",
  event: "#fb7185",
  other: "#71717a",
};
function colorForNode(n: GraphNode): string {
  if (n.type === "entity") return ENTITY_COLORS[n.entity_type ?? "other"] ?? "#71717a";
  return colorForFile(fileIdOf(n));
}

interface D3Node extends d3.SimulationNodeDatum, GraphNode {
  r: number;
  color: string;
}
interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  kind: "contains" | "similar" | "relates" | "mentions";
  weight?: number;
  label?: string;
}
function linkId(v: string | number | D3Node): string {
  return typeof v === "object" ? v.id : String(v);
}

/* Layout persistence (per model + file filter) */
function layoutKey(model: string | undefined, fileFilter: number | null): string {
  return `ragui-graph-layout:${model ?? "auto"}:${fileFilter ?? "all"}`;
}
function loadPositions(key: string): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, { x: number; y: number }>) : {};
  } catch {
    return {};
  }
}

const FETCH_FLOOR = 0.4; // backend returns links >= this; slider filters client-side

export default function KnowledgeGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [fileFilter, setFileFilter] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<"balanced" | "recent">("balanced");
  const [layer, setLayer] = useState<GraphLayer>("chunks");
  const [minSim, setMinSim] = useState(0.55);
  const [showSimilar, setShowSimilar] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [running, setRunning] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<D3Node[]>([]);
  const linksRef = useRef<D3Link[]>([]);
  const simRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const uiRef = useRef({
    showLabels: true, search: "", selectedId: null as string | null,
    hoverId: null as string | null, cited: new Set<string>(),
  });
  const [tick, setTick] = useState(0);

  const setActiveView = useViewStore((s) => s.setActiveView);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);
  const chatMessages = useChatStore((s) => s.messages);
  const focusNodeId = useGraphStore((s) => s.focusNodeId);
  const clearFocus = useGraphStore((s) => s.clearFocus);

  /* Cited chunk ids from chat answers -> highlight in graph */
  const cited = useMemo(() => {
    const s = new Set<string>();
    for (const m of chatMessages) {
      for (const src of m.sources ?? []) s.add(`c${src.id}`);
    }
    return s;
  }, [chatMessages]);
  uiRef.current = { showLabels, search, selectedId, hoverId, cited };

  /* ------------------------------ fetch ------------------------------ */
  const fetchGraph = useCallback(async (opts?: {
    model?: string; fileId?: number | null; strategy?: "balanced" | "recent"; layer?: GraphLayer;
  }) => {
    setLoading(true);
    try {
      const g = await getKnowledgeGraph({
        model: opts?.model,
        fileId: opts?.fileId ?? undefined,
        minSimilarity: FETCH_FLOOR,
        limit: 200,
        neighbors: 3,
        strategy: opts?.strategy ?? "balanced",
        layer: opts?.layer ?? "chunks",
      });
      setData(g);
      if (!opts?.model && g.model) setModel((m) => m ?? g.model ?? undefined);
    } catch (err) {
      toast("error", `Graph failed to load: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const refetch = (opts?: { model?: string; fileId?: number | null; strategy?: "balanced" | "recent"; layer?: GraphLayer }) =>
    fetchGraph({
      model: opts?.model ?? model,
      fileId: opts?.fileId !== undefined ? opts.fileId : fileFilter,
      strategy: opts?.strategy ?? strategy,
      layer: opts?.layer ?? layer,
    });

  const onModelChange = (m: string) => {
    setModel(m);
    setFileFilter(null);
    setSelectedId(null);
    fetchGraph({ model: m, fileId: null, strategy, layer });
  };
  const onFileChange = (fid: number | null) => {
    setFileFilter(fid);
    setSelectedId(null);
    fetchGraph({ model, fileId: fid, strategy, layer });
  };
  const onStrategyChange = (s: "balanced" | "recent") => {
    setStrategy(s);
    fetchGraph({ model, fileId: fileFilter, strategy: s, layer });
  };
  const onLayerChange = (l: GraphLayer) => {
    setLayer(l);
    setSelectedId(null);
    fetchGraph({ model, fileId: fileFilter, strategy, layer: l });
  };

  const files = useMemo(() => (data?.nodes ?? []).filter((n) => n.type === "file"), [data]);

  /* Client-side visible links: kind toggle + similarity slider (no refetch).
     Entity-layer links (relates/mentions) always pass — only chunk similarity
     is threshold-filtered. */
  const visibleLinks = useMemo(() => {
    if (!data) return [];
    return data.edges.filter((e) => {
      if (e.kind === "contains" || e.kind === "relates" || e.kind === "mentions") return true;
      return showSimilar && (e.weight ?? 0) >= minSim;
    });
  }, [data, showSimilar, minSim]);

  const counts = useMemo(() => {
    const n = data?.nodes ?? [];
    return {
      files: n.filter((x) => x.type === "file").length,
      chunks: n.filter((x) => x.type === "chunk").length,
      entities: n.filter((x) => x.type === "entity").length,
      similar: visibleLinks.filter((e) => e.kind === "similar").length,
      relations: visibleLinks.filter((e) => e.kind === "relates").length,
    };
  }, [data, visibleLinks]);

  const selected: GraphNode | null = useMemo(() => {
    if (!selectedId) return null;
    return nodesRef.current.find((n) => n.id === selectedId)
      ?? data?.nodes.find((n) => n.id === selectedId) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tick, data]);

  const selectedNeighborCount = useMemo(() => {
    if (!selectedId) return 0;
    let c = 0;
    for (const e of visibleLinks) {
      if (e.kind === "similar" && (e.source === selectedId || e.target === selectedId)) c++;
    }
    return c;
  }, [selectedId, visibleLinks]);

  /* Relations touching the selected entity (for the detail panel). */
  const selectedRelations = useMemo(() => {
    if (!selectedId) return [];
    const out: { label: string; otherId: string; otherLabel: string }[] = [];
    const byId = new Map((data?.nodes ?? []).map((n) => [n.id, n.label]));
    for (const e of visibleLinks) {
      if (e.kind !== "relates") continue;
      if (e.source === selectedId) {
        out.push({ label: e.label ?? "related", otherId: e.target, otherLabel: byId.get(e.target) ?? e.target });
      } else if (e.target === selectedId) {
        out.push({ label: e.label ?? "related", otherId: e.source, otherLabel: byId.get(e.source) ?? e.source });
      }
    }
    return out.slice(0, 10);
  }, [selectedId, visibleLinks, data]);

  /* -------------------------------- draw -------------------------------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const h = Math.max(420, Math.min(620, window.innerHeight * 0.6));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, w, h);

    // static dot grid (screen space)
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    const gap = 28;
    for (let x = (w / 2) % gap; x < w; x += gap)
      for (let y = (h / 2) % gap; y < h; y += gap) ctx.fillRect(x, y, 1, 1);

    const t = transformRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const { showLabels: labelsOn, search: qRaw, selectedId: sel, hoverId: hov, cited: citedSet } = uiRef.current;
    const q = qRaw.trim().toLowerCase();
    const focused = sel ?? hov;
    const focusSet = new Set<string>();
    if (focused) {
      focusSet.add(focused);
      for (const l of links) {
        const a = linkId(l.source);
        const b = linkId(l.target);
        if (a === focused) focusSet.add(b);
        if (b === focused) focusSet.add(a);
      }
    }
    const matches = (n: D3Node) =>
      !q || n.label.toLowerCase().includes(q) || (n.preview ?? "").toLowerCase().includes(q);

    ctx.save();
    ctx.translate(w / 2 + t.x, h / 2 + t.y);
    ctx.scale(t.k, t.k);
    ctx.lineWidth = 1 / t.k;

    for (const l of links) {
      const a = typeof l.source === "object" ? l.source : nodes.find((n) => n.id === String(l.source));
      const b = typeof l.target === "object" ? l.target : nodes.find((n) => n.id === String(l.target));
      if (!a || !b || a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) continue;
      const isFocus = focused !== null && (linkId(l.source) === focused || linkId(l.target) === focused);
      if (focused && !isFocus) continue;
      if (l.kind === "contains") {
        ctx.strokeStyle = isFocus ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.10)";
        ctx.lineWidth = (isFocus ? 1.6 : 1) / t.k;
      } else if (l.kind === "similar") {
        const alpha = 0.12 + ((l.weight ?? 0.6) - 0.4) * 0.9;
        ctx.strokeStyle = isFocus
          ? "rgba(45,212,191,0.95)"
          : `rgba(45,212,191,${Math.max(0.1, Math.min(0.75, alpha))})`;
        ctx.lineWidth = (isFocus ? 2 : 0.6 + (l.weight ?? 0.6) * 1.6) / t.k;
      } else if (l.kind === "relates") {
        ctx.strokeStyle = isFocus ? "rgba(196,181,253,0.95)" : "rgba(167,139,250,0.55)";
        ctx.lineWidth = (isFocus ? 2 : 1.2) / t.k;
      } else {
        // mentions: faint dashed entity→chunk provenance links
        ctx.strokeStyle = isFocus ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1 / t.k;
        ctx.setLineDash([4 / t.k, 4 / t.k]);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Relation labels at high zoom or on focus
      if (l.kind === "relates" && l.label && (isFocus || t.k > 1.3)) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const fs = 9 / t.k;
        ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(l.label).width;
        ctx.fillStyle = focused && !isFocus ? "rgba(0,0,0,0)" : "rgba(24,24,27,0.85)";
        if (!focused || isFocus) {
          ctx.fillRect(mx - tw / 2 - 3 / t.k, my - 7 / t.k, tw + 6 / t.k, 13 / t.k);
          ctx.fillStyle = "#c4b5fd";
          ctx.fillText(l.label, mx - tw / 2, my + 3.5 / t.k);
        }
      }
    }

    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const m = matches(n);
      const dim = focused ? !focusSet.has(n.id) : !m;
      ctx.globalAlpha = dim ? 0.18 : 1;

      if (n.type === "file") {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = "#18181b";
        ctx.fill();
        ctx.lineWidth = 2.5 / t.k;
        ctx.strokeStyle = n.color;
        ctx.stroke();
        ctx.fillStyle = n.color;
        const s = 5.5 / Math.max(0.8, t.k);
        ctx.fillRect(n.x - s * 0.72, n.y - s, s * 1.44, s * 2);
        ctx.fillStyle = "#09090b";
        ctx.fillRect(n.x - s * 0.27, n.y - s, s * 0.54, s * 2);
      } else if (n.type === "entity") {
        // diamond node, colored by entity type
        ctx.beginPath();
        ctx.moveTo(n.x, n.y - n.r);
        ctx.lineTo(n.x + n.r, n.y);
        ctx.lineTo(n.x, n.y + n.r);
        ctx.lineTo(n.x - n.r, n.y);
        ctx.closePath();
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.lineWidth = 1.5 / t.k;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.lineWidth = 1.5 / t.k;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();
      }

      const ring = (extra: number, style: string, width: number) => {
        ctx.beginPath();
        ctx.arc(n.x as number, n.y as number, n.r + extra, 0, Math.PI * 2);
        ctx.lineWidth = width / t.k;
        ctx.strokeStyle = style;
        ctx.stroke();
      };
      if (n.id === sel) ring(5, "#fafafa", 2);
      else if (n.id === hov) ring(3.5, "rgba(250,250,250,0.7)", 1.5);
      else if (q && m) ring(3, "rgba(250,204,21,0.8)", 1.5);
      else if (citedSet.has(n.id)) ring(3, "rgba(167,139,250,0.9)", 1.5);
      ctx.globalAlpha = 1;

      const showChunkLabel =
        labelsOn && (n.type !== "chunk" || t.k > 1.15 || n.id === hov || n.id === sel || (q !== "" && m));
      if (showChunkLabel && !dim) {
        const fs = (n.type === "file" ? 11 : 10) / t.k;
        ctx.font = `${n.type === "file" ? "600" : "500"} ${fs}px Inter, system-ui, sans-serif`;
        const text = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
        const tw = ctx.measureText(text).width;
        const bx = n.x - tw / 2 - 4 / t.k;
        const by = n.y + n.r + 4 / t.k;
        const bw = tw + 8 / t.k;
        const bh = 15 / t.k;
        const rr = 4 / t.k;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.moveTo(bx + rr, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
        ctx.arcTo(bx, by + bh, bx, by, rr);
        ctx.arcTo(bx, by, bx + bw, by, rr);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = n.type === "file" ? "#fafafa" : "#d4d4d8";
        ctx.fillText(text, n.x - tw / 2, by + 11 / t.k);
      }
    }
    ctx.restore();
  }, []);

  /* ------------------------- d3 simulation setup ------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !data) return;

    const W = wrap.clientWidth || 800;
    const R = Math.min(W, 520) / 2.4;
    const saved = loadPositions(layoutKey(model, fileFilter));
    const nodes: D3Node[] = data.nodes.map((n, i) => {
      const a = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      const p = saved[n.id];
      const r =
        n.type === "file" ? 17
        : n.type === "entity" ? 9 + Math.min(7, (n.mention_count ?? 1) / 4)
        : 6 + Math.min(4, ((n.token_count ?? 200) / 400) * 4);
      return {
        ...n,
        x: p?.x ?? Math.cos(a) * R + (Math.random() - 0.5) * 60,
        y: p?.y ?? Math.sin(a) * R + (Math.random() - 0.5) * 60,
        vx: 0, vy: 0,
        r,
        color: colorForNode(n),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: D3Link[] = visibleLinks
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        source: byId.get(e.source) as D3Node,
        target: byId.get(e.target) as D3Node,
        kind: e.kind,
        weight: e.weight,
        label: e.label,
      }));
    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();
    const sim = d3
      .forceSimulation<D3Node, D3Link>(nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(links)
        .id((d) => d.id)
        .distance((l) => l.kind === "contains" ? 90 : l.kind === "similar" ? 150 : l.kind === "relates" ? 170 : 70)
        .strength((l) => l.kind === "contains" ? 0.5 : l.kind === "similar" ? 0.15 * (l.weight ?? 0.7) : l.kind === "relates" ? 0.4 : 0.25))
      .force("charge", d3.forceManyBody<D3Node>().strength((d) => (d.type === "file" ? -700 : d.type === "entity" ? -380 : -220)).distanceMax(420))
      .force("center", d3.forceCenter<D3Node>(0, 0).strength(0.06))
      .force("collide", d3.forceCollide<D3Node>().radius((d) => d.r + 14).strength(0.7))
      .force("x", d3.forceX<D3Node>(0).strength(0.04))
      .force("y", d3.forceY<D3Node>(0).strength(0.04))
      .alphaDecay(0.028)
      .on("tick", draw)
      .on("end", () => {
        setRunning(false);
        try {
          const pos: Record<string, { x: number; y: number }> = {};
          for (const n of nodesRef.current) {
            if (n.x !== undefined && n.y !== undefined) pos[n.id] = { x: n.x, y: n.y };
          }
          localStorage.setItem(layoutKey(model, fileFilter), JSON.stringify(pos));
        } catch { /* storage full — ignore */ }
      });
    simRef.current = sim;
    setRunning(true);
    setTick((t) => t + 1);

    // zoom + pan (wheel, touch-pinch included)
    const zoom = d3.zoom<HTMLCanvasElement, unknown>().scaleExtent([0.3, 4]).on("zoom", (e) => {
      transformRef.current = e.transform;
      draw();
    });
    zoomRef.current = zoom;
    d3.select(canvas).call(zoom);
    transformRef.current = d3.zoomIdentity;

    // drag nodes
    const pick = (ev: { x: number; y: number }): D3Node | null => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const cx = ev.x - rect.left - rect.width / 2;
      const cy = ev.y - rect.top - rect.height / 2;
      let best: D3Node | null = null;
      let bestD = 26;
      for (const n of nodesRef.current) {
        if (n.x === undefined || n.y === undefined) continue;
        const d = Math.hypot(cx - (n.x * t.k + t.x), cy - (n.y * t.k + t.y));
        if (d < bestD + n.r * t.k * 0.5) { bestD = d; best = n; }
      }
      return best;
    };
    let moved = 0;
    const toWorld = (px: number, py: number): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      return [
        (px - rect.left - rect.width / 2 - t.x) / t.k,
        (py - rect.top - rect.height / 2 - t.y) / t.k,
      ];
    };
    const drag = d3.drag<HTMLCanvasElement, unknown>()
      .subject((ev) => pick(ev))
      .on("start", (ev) => {
        moved = 0;
        const s = ev.subject as D3Node | null;
        if (!s) return;
        sim.alphaTarget(0.3).restart();
        s.fx = s.x; s.fy = s.y;
      })
      .on("drag", (ev) => {
        const s = ev.subject as D3Node | null;
        if (!s) return;
        moved += Math.abs(ev.dx) + Math.abs(ev.dy);
        const [wx, wy] = toWorld(ev.x, ev.y);
        s.fx = wx; s.fy = wy;
      })
      .on("end", (ev) => {
        const s = ev.subject as D3Node | null;
        sim.alphaTarget(0);
        if (!s) return;
        s.fx = null; s.fy = null;
        if (moved < 5) setSelectedId(s.id); // treat as click
        try {
          const pos: Record<string, { x: number; y: number }> = {};
          for (const n of nodesRef.current) {
            if (n.x !== undefined && n.y !== undefined) pos[n.id] = { x: n.x, y: n.y };
          }
          localStorage.setItem(layoutKey(model, fileFilter), JSON.stringify(pos));
        } catch { /* ignore */ }
      });
    d3.select(canvas).call(drag);

    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* Links update live (slider/toggle) without rebuilding the sim */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !data) return;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    linksRef.current = visibleLinks
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        source: byId.get(e.source) as D3Node,
        target: byId.get(e.target) as D3Node,
        kind: e.kind,
        weight: e.weight,
        label: e.label,
      }));
    (sim.force("link") as d3.ForceLink<D3Node, D3Link>).links(linksRef.current);
    sim.alpha(0.5).restart();
    draw();
  }, [visibleLinks, data, draw]);

  /* Redraw on UI state (search/hover/select/labels/cited) */
  useEffect(() => { draw(); }, [draw, search, hoverId, selectedId, showLabels, chatMessages, tick]);

  const pickNodeAt = (clientX: number, clientY: number): D3Node | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    let best: D3Node | null = null;
    let bestD = 26;
    for (const n of nodesRef.current) {
      if (n.x === undefined || n.y === undefined) continue;
      const d = Math.hypot(cx - (n.x * t.k + t.x), cy - (n.y * t.k + t.y));
      if (d < bestD + n.r * t.k * 0.5) { bestD = d; best = n; }
    }
    return best;
  };

  const onHover = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.buttons > 0) return;
    const hit = pickNodeAt(e.clientX, e.clientY);
    setHoverId(hit?.id ?? null);
    const canvas = canvasRef.current;
    if (hit && canvas) {
      const rect = canvas.getBoundingClientRect();
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        text: hit.type === "file" ? `${hit.label} · ${hit.chunk_count ?? 0} chunks` : hit.label,
      });
    } else setTooltip(null);
  };

  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    if (!canvas || !zoom) return;
    d3.select(canvas).transition().duration(150).call(zoom.scaleBy, factor);
  };

  /** Center the viewport on a node (used by chat handoff + keyboard nav). */
  const centerOnNode = useCallback((id: string): boolean => {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    const n = nodesRef.current.find((nn) => nn.id === id);
    if (!canvas || !zoom || !n || n.x === undefined || n.y === undefined) return false;
    const k = Math.max(transformRef.current.k, 1.1);
    d3.select(canvas).transition().duration(400).call(
      zoom.transform,
      d3.zoomIdentity.translate(-n.x * k, -n.y * k).scale(k)
    );
    return true;
  }, []);

  /* Chat handoff: a "view in graph" request selects + centers the node. */
  useEffect(() => {
    if (!focusNodeId || !data) return;
    const known = data.nodes.some((n) => n.id === focusNodeId);
    if (!known) {
      toast("info", "That chunk isn't in the current graph view — try filtering by file.");
    } else {
      setSelectedId(focusNodeId);
      // Defer one frame so the sim has node positions ready.
      requestAnimationFrame(() => centerOnNode(focusNodeId));
    }
    clearFocus();
  }, [focusNodeId, data, centerOnNode, clearFocus]);

  /* Keyboard navigation on the canvas: arrows cycle nodes, +/- zoom, 0 recenter. */
  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    const nodes = nodesRef.current;
    if (!nodes.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const ix = nodes.findIndex((n) => n.id === selectedId);
      const next = nodes[(ix + dir + nodes.length) % nodes.length];
      setSelectedId(next.id);
      centerOnNode(next.id);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1.25);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomBy(0.8);
    } else if (e.key === "0") {
      e.preventDefault();
      recenter();
    }
  };
  const recenter = () => {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    if (!canvas || !zoom) return;
    d3.select(canvas).transition().duration(250).call(zoom.transform, d3.zoomIdentity);
  };
  const fitView = () => {
    const canvas = canvasRef.current;
    const zoom = zoomRef.current;
    const nodes = nodesRef.current;
    if (!canvas || !zoom || !nodes.length) return;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const dx = Math.max(200, Math.max(...xs) - Math.min(...xs) + 160);
    const dy = Math.max(200, Math.max(...ys) - Math.min(...ys) + 160);
    const rect = canvas.getBoundingClientRect();
    const s = Math.max(0.3, Math.min(1.6, Math.min(rect.width / dx, rect.height / dy)));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    d3.select(canvas).transition().duration(300).call(
      zoom.transform,
      d3.zoomIdentity.translate(-cx * s, -cy * s).scale(s)
    );
  };
  const toggleRunning = () => {
    const sim = simRef.current;
    if (!sim) return;
    if (running) sim.stop();
    else sim.alpha(0.6).restart();
    setRunning(!running);
  };
  const resetLayout = () => {
    try { localStorage.removeItem(layoutKey(model, fileFilter)); } catch { /* ignore */ }
    refetch();
  };

  const askAbout = () => {
    if (!selected) return;
    if (selected.type === "entity") {
      setPendingPrompt(
        `What do my documents say about "${selected.label}" (${selected.entity_type ?? "concept"})?`
      );
    } else if (selected.type === "chunk") {
      const quote = (selected.preview ?? "").slice(0, 400);
      setPendingPrompt(
        `Explain this passage from "${selected.filename ?? selected.label}":\n\n${quote}`
      );
    } else {
      return;
    }
    setActiveView("chat");
    toast("success", "Question sent to chat.");
  };

  /* -------------------------------- render -------------------------------- */
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900/30">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-900 px-4 py-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chunks, headings…"
            className="w-44 rounded-lg border border-zinc-800 bg-zinc-950/60 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300" aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        {data && data.models_available.length > 0 && (
          <select
            value={model ?? data.model ?? ""}
            onChange={(e) => onModelChange(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 font-mono text-[11px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
            title="Embedding model"
          >
            {data.models_available.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        <select
          value={fileFilter ?? ""}
          onChange={(e) => onFileChange(e.target.value ? Number(e.target.value) : null)}
          className="max-w-[170px] truncate rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-[11px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
          title="Filter to one file"
        >
          <option value="">All files</option>
          {files.map((f) => (
            <option key={f.id} value={f.file_id}>{f.label}</option>
          ))}
        </select>

        <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5 text-[11px]" title="Graph layer">
          {(["chunks", "entities", "both"] as const).map((l) => (
            <button
              key={l}
              onClick={() => onLayerChange(l)}
              className={`rounded-md px-2 py-1 font-medium capitalize transition-colors ${layer === l ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5 text-[11px]" title="Sampling when chunks exceed the 200-node budget">
          {(["balanced", "recent"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onStrategyChange(s)}
              className={`rounded-md px-2 py-1 font-medium capitalize transition-colors ${strategy === s ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {s}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-[11px] text-zinc-400" title="Minimum cosine similarity — filters instantly, no reload">
          <Waypoints size={12} className="text-teal-400" />
          ≥{minSim.toFixed(2)}
          <input
            type="range" min={0.4} max={0.9} step={0.05} value={minSim}
            onChange={(e) => setMinSim(Number(e.target.value))}
            className="h-1 w-20 accent-teal-400"
          />
        </label>

        <button
          onClick={() => setShowSimilar((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${showSimilar ? "border-teal-900/60 bg-teal-950/40 text-teal-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
          title="Toggle semantic similarity links"
        >
          <Waypoints size={12} /> Links
        </button>
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${showLabels ? "border-zinc-700 bg-zinc-800/60 text-zinc-200" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
          title="Toggle labels"
        >
          <Tags size={12} /> Labels
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => zoomBy(1.25)} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-zinc-200" aria-label="Zoom in"><ZoomIn size={13} /></button>
          <button onClick={() => zoomBy(0.8)} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-zinc-200" aria-label="Zoom out"><ZoomOut size={13} /></button>
          <button onClick={fitView} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-zinc-200" aria-label="Fit to view"><Maximize2 size={13} /></button>
          <button onClick={recenter} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-zinc-200" aria-label="Recenter"><Crosshair size={13} /></button>
          <button onClick={toggleRunning} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-500 hover:text-zinc-200" aria-label={running ? "Pause physics" : "Resume physics"}>
            {running ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button onClick={resetLayout} className="rounded-lg border border-zinc-800 px-2 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-200" title="Clear saved layout and reload">
            Reset
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="relative w-full cursor-grab bg-[#09090b] active:cursor-grabbing">
        {loading ? (
          <div className="flex h-[480px] items-center justify-center gap-2 text-xs text-zinc-500">
            <Spinner /> Building graph…
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <div className="flex h-[480px] flex-col items-center justify-center gap-2 px-6 text-center text-zinc-600">
            <FileText size={22} className="text-zinc-700" />
            {layer === "chunks" ? (
              <p className="text-xs">No chunks to visualize yet — upload a document first.</p>
            ) : (
              <p className="text-xs">
                No entities yet — enable “Extract knowledge graph” on upload,
                or use the Extract button in the file list.
              </p>
            )}
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="block w-full touch-none"
              role="img"
              aria-label={
                data
                  ? `Knowledge graph: ${counts.files} documents, ${counts.chunks} chunks, ${counts.entities} entities, ${counts.similar} similarity links, ${counts.relations} relations. Use left and right arrows to explore nodes, plus and minus to zoom.`
                  : "Knowledge graph"
              }
              tabIndex={0}
              onKeyDown={onCanvasKeyDown}
              onPointerMove={onHover}
              onPointerLeave={() => { setHoverId(null); setTooltip(null); }}
            />
            {/* Screen-reader announcements for keyboard selection */}
            <div aria-live="polite" className="sr-only">
              {selected ? `Selected ${selected.type}: ${selected.label}` : ""}
            </div>
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 max-w-[220px] truncate rounded-lg border border-zinc-700 bg-zinc-950/95 px-2 py-1 text-[11px] text-zinc-200 shadow-xl"
                style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
              >
                {tooltip.text}
              </div>
            )}

            <div className="absolute left-3 top-3 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/85 px-3 py-2 text-[10.5px] text-zinc-400 backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-zinc-400 bg-zinc-900" /> File
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-400" /> Chunk
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 bg-teal-400/70" /> Similar
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 bg-violet-400"
                  style={{ transform: "rotate(45deg) scale(0.9)" }}
                /> Entity
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 bg-violet-400/70" /> Relation
              </span>
              {cited.size > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-violet-400" /> Cited in chat
                </span>
              )}
              <span className="hidden sm:inline text-zinc-600">
                {counts.files > 0 && <>{counts.files} files · </>}
                {counts.chunks > 0 && <>{counts.chunks} chunks · </>}
                {counts.entities > 0 && <>{counts.entities} entities · </>}
                {counts.similar > 0 && <>{counts.similar} sim · </>}
                {counts.relations > 0 && <>{counts.relations} rel · </>}
                d3-force
              </span>
            </div>

            {data.truncated && (
              <div className="absolute right-3 top-3 rounded-xl border border-amber-900/50 bg-amber-950/60 px-3 py-1.5 text-[10.5px] text-amber-300 backdrop-blur">
                Showing {data.returned_chunks} of {data.total_chunks} ({strategy}) — filter by file for more.
              </div>
            )}

            {selected && (
              <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm rounded-2xl border border-zinc-700/80 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: colorForNode(selected) }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {selected.type === "file" ? "Document" : selected.type === "entity" ? `Entity · ${selected.entity_type ?? "concept"}` : "Chunk"}
                    </span>
                  </div>
                  <button onClick={() => setSelectedId(null)} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close details">
                    <X size={13} />
                  </button>
                </div>
                <h3 className="truncate text-sm font-semibold text-zinc-100" title={selected.label}>{selected.label}</h3>
                {selected.filename && selected.type === "chunk" && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{selected.filename}</p>
                )}
                {selected.type === "file" ? (
                  <p className="mt-2 text-xs text-zinc-400">{selected.chunk_count ?? 0} chunks in this view. Click a chunk node to read it.</p>
                ) : selected.type === "entity" ? (
                  <>
                    <p className="mt-1.5 text-[11px] text-zinc-500">
                      Mentioned {selected.mention_count ?? 0} time{(selected.mention_count ?? 0) === 1 ? "" : "s"}
                      {selectedRelations.length > 0 && ` · ${selectedRelations.length} relation${selectedRelations.length === 1 ? "" : "s"}`}
                    </p>
                    {selectedRelations.length > 0 && (
                      <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                        {selectedRelations.map((r) => (
                          <li key={`${r.label}-${r.otherId}`}>
                            <button
                              onClick={() => { setSelectedId(r.otherId); centerOnNode(r.otherId); }}
                              className="flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-1 text-left text-[11px] text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                              title={`Go to ${r.otherLabel}`}
                            >
                              <span className="shrink-0 rounded bg-violet-950/60 px-1.5 py-0.5 font-medium text-violet-300">{r.label}</span>
                              <span className="truncate">{r.otherLabel}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      onClick={askAbout}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-teal-950/60 border border-teal-900/60 px-3 py-1.5 text-xs font-medium text-teal-300 transition-colors hover:bg-teal-900/60"
                    >
                      <MessageSquarePlus size={13} /> Ask chat about “{selected.label}”
                    </button>
                  </>
                ) : (
                  <>
                    {selected.headings && selected.headings.length > 0 && (
                      <p className="mt-1.5 truncate text-[11px] text-teal-300/90" title={selected.headings.join(" / ")}>
                        {selected.headings.join(" / ")}
                      </p>
                    )}
                    <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-zinc-400">{selected.preview}</p>
                    <div className="mt-2 flex items-center gap-2 text-[10.5px] text-zinc-600">
                      {selected.token_count ? <span>{selected.token_count} tokens</span> : null}
                      {selectedNeighborCount > 0 && <span>· {selectedNeighborCount} similar link{selectedNeighborCount === 1 ? "" : "s"}</span>}
                    </div>
                    <button
                      onClick={askAbout}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-teal-950/60 border border-teal-900/60 px-3 py-1.5 text-xs font-medium text-teal-300 transition-colors hover:bg-teal-900/60"
                    >
                      <MessageSquarePlus size={13} /> Ask chat about this chunk
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Text alternative: full node list for screen readers + keyboard users */}
      {data && data.nodes.length > 0 && (
        <details className="border-t border-zinc-900 px-4 py-2.5">
          <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 hover:text-zinc-300">
            Node list ({counts.chunks} chunks in {counts.files} files) — text alternative
          </summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pb-2">
            {data.nodes.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => { setSelectedId(n.id); centerOnNode(n.id); }}
                  className={`w-full truncate rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                    n.id === selectedId
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: colorForFile(n.file_id) }} />
                  [{n.type}] {n.label}
                  {n.filename && n.type === "chunk" ? ` — ${n.filename}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-900 px-4 py-2.5 text-[10.5px] text-zinc-600">
        <span>Drag a node to move it · scroll to zoom · drag background to pan · ←/→ keys explore</span>
        <span className="ml-auto font-mono">{data?.model ?? "—"}</span>
      </div>
    </div>
  );
}
