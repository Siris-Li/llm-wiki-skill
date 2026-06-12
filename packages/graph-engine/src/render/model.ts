import type { GraphData, PinMap, SelectionInput, ThemeId, WikiPath } from "../types";
import {
  atlasNodePoint,
  atlasPointToMinimap,
  buildAtlasModel,
  deriveAtlasLayout,
  resolveAtlasVisibleSnapshot
} from "../model";
import { getCommunityColor } from "../themes";

export type DensityMode = "card" | "compact-card" | "point-plus-focus" | "overview";
export type NodeDisplayMode = "card" | "compact-card" | "point" | "overview";
export type NodeVisualRole = "landmark" | "index-slip" | "cinnabar-note" | "map-pin";

export interface RenderableGraph {
  model: Record<string, unknown>;
  layout: Record<string, unknown>;
  selectedNodeId: string | null;
  densityMode: DensityMode;
  counts: {
    visibleNodes: number;
    visibleEdges: number;
    totalNodes: number;
    totalEdges: number;
    totalCommunities: number;
  };
  nodes: RenderableNode[];
  edges: RenderableEdge[];
  communities: RenderableCommunity[];
  minimap: RenderableMinimap;
}

export interface RenderableNode {
  id: string;
  label: string;
  type: string;
  kind: string;
  community: string;
  sourcePath: string;
  x: number;
  y: number;
  point: { x: number; y: number };
  displayMode: NodeDisplayMode;
  visualRole: NodeVisualRole;
  priority: number;
  weight: number;
  unavailable: boolean;
  selected: boolean;
  startNode: boolean;
  previewStart: boolean;
  labelVisible: boolean;
}

export interface RenderableEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  path: string;
  strokeWidth: number;
  opacity: number;
}

export interface RenderableCommunity {
  id: string;
  label: string;
  color: string;
  nodeCount: number;
  wash: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    opacity: number;
  } | null;
}

export interface RenderableMinimap {
  path: string;
  nodes: Array<{ id: string; x: number; y: number; r: number; fill: string; selected: boolean }>;
}

interface BuildRenderableGraphOptions {
  pins?: PinMap;
  theme?: ThemeId;
  selectedNodeId?: string | null;
  selection?: SelectionInput | null;
}

type AtlasNode = {
  id: string;
  label: string;
  type: string;
  kind: string;
  community: string;
  source_path?: string;
  x: number;
  y: number;
  priority?: number;
  weight?: number;
  unavailable?: boolean;
};

type AtlasEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  weight?: number;
};

type AtlasCommunity = {
  id: string;
  label?: string;
  node_count?: number;
  color_index?: number;
};

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 680;
const MINIMAP_PATH = "M8 40 C34 20 54 36 76 22 C98 8 118 24 150 12";

export function buildRenderableGraph(data: GraphData, options: BuildRenderableGraphOptions = {}): RenderableGraph {
  const theme = options.theme || "shan-shui";
  const dataWithPins = applyPinsToGraphData(data, options.pins || {});
  const model = buildAtlasModel(dataWithPins) as {
    nodes: AtlasNode[];
    edges: AtlasEdge[];
    byId: Record<string, AtlasNode>;
    communities: AtlasCommunity[];
    communityById: Record<string, AtlasCommunity>;
  };
  const layout = deriveAtlasLayout(model) as Record<string, unknown>;
  const selectedNodeId = resolveSelectedNodeId(model, options);
  const visible = resolveAtlasVisibleSnapshot(model, layout, { selectedNodeId }) as {
    nodes: AtlasNode[];
    edges: AtlasEdge[];
    densityMode: DensityMode;
    labelNodeIds: Record<string, boolean>;
    importantNodeIds: Record<string, boolean>;
    startNodeIds: Record<string, boolean>;
    starts: Array<{ node: AtlasNode }>;
    counts: {
      visible_nodes: number;
      visible_edges: number;
      total_nodes: number;
      total_edges: number;
      total_communities: number;
    };
  };
  const previewNodeId = selectedNodeId ? null : firstPreviewNodeId(visible);
  const importantIds = visible.importantNodeIds || {};
  const labelIds = visible.labelNodeIds || {};
  const startIds = visible.startNodeIds || {};

  const nodes = visible.nodes.map((node) => {
    const displayMode = nodeDisplayMode(node, visible.densityMode, selectedNodeId, previewNodeId, labelIds, importantIds);
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      kind: node.kind,
      community: node.community,
      sourcePath: node.source_path || "",
      x: node.x,
      y: node.y,
      point: atlasNodePoint(node) as { x: number; y: number },
      displayMode,
      visualRole: nodeVisualRole(node, displayMode, selectedNodeId, previewNodeId, importantIds),
      priority: Number(node.priority || 0),
      weight: Number(node.weight || 0),
      unavailable: node.unavailable === true,
      selected: node.id === selectedNodeId,
      startNode: startIds[node.id] === true,
      previewStart: node.id === previewNodeId,
      labelVisible: labelIds[node.id] === true
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = visible.edges.flatMap((edge) => {
    const source = model.byId[edge.source];
    const target = model.byId[edge.target];
    if (!source || !target) return [];
    return [{
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: String(edge.type || "EXTRACTED").toLowerCase(),
      path: makeEdgePath(source, target, edge),
      strokeWidth: edgeStrokeWidth(edge),
      opacity: edgeOpacity(edge)
    }];
  });

  const communities = model.communities.map((community, index) => {
    const communityNodes = nodes.filter((node) => node.community === community.id);
    return {
      id: community.id,
      label: community.label || community.id,
      color: getCommunityColor(theme, Number(community.color_index ?? index)),
      nodeCount: Number(community.node_count ?? communityNodes.length),
      wash: computeCommunityWash(communityNodes)
    };
  });
  const communityById = new Map(communities.map((community) => [community.id, community]));

  return {
    model,
    layout,
    selectedNodeId,
    densityMode: visible.densityMode,
    counts: {
      visibleNodes: visible.counts.visible_nodes,
      visibleEdges: visible.counts.visible_edges,
      totalNodes: visible.counts.total_nodes,
      totalEdges: visible.counts.total_edges,
      totalCommunities: visible.counts.total_communities
    },
    nodes,
    edges,
    communities: communities.filter((community) => community.wash),
    minimap: {
      path: MINIMAP_PATH,
      nodes: nodes.slice(0, 60).map((node) => {
        const point = atlasPointToMinimap(node.point) as { x: number; y: number };
        return {
          id: node.id,
          x: point.x,
          y: point.y,
          r: node.selected ? 3.2 : 2.2,
          fill: communityById.get(node.community)?.color || getCommunityColor(theme, 0),
          selected: node.selected
        };
      })
    }
  };
}

export function makeEdgePath(source: AtlasNode, target: AtlasNode, edge: { weight?: number }): string {
  const sourcePoint = atlasNodePoint(source) as { x: number; y: number };
  const targetPoint = atlasNodePoint(target) as { x: number; y: number };
  const x1 = sourcePoint.x;
  const y1 = sourcePoint.y;
  const x2 = targetPoint.x;
  const y2 = targetPoint.y;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const curve = Math.max(-76, Math.min(76, (source.y - target.y) * 1.8 + (clampWeight(edge.weight) - 0.5) * 24));
  return `M ${round(x1)} ${round(y1)} Q ${round(mx + curve)} ${round(my - 22)} ${round(x2)} ${round(y2)}`;
}

export function edgeStrokeWidth(edge: { weight?: number }): number {
  return round(1.1 + clampWeight(edge.weight) * 1.8);
}

export function edgeOpacity(edge: { weight?: number }): number {
  return round(0.32 + clampWeight(edge.weight) * 0.44);
}

function applyPinsToGraphData(data: GraphData, pins: PinMap): GraphData {
  if (!Object.keys(pins).length) return data;
  return {
    ...data,
    nodes: data.nodes.map((node) => {
      const pin = pins[pinKeyForNode(node)];
      if (!pin) return node;
      return {
        ...node,
        x: normalizePinnedX(pin.x),
        y: normalizePinnedY(pin.y)
      };
    })
  };
}

function pinKeyForNode(node: { source_path?: unknown; path?: unknown; source?: unknown; id: string }): WikiPath {
  return String(node.source_path || node.path || node.source || node.id);
}

function normalizePinnedX(value: number): number {
  return value > 100 ? clamp(value / WORLD_WIDTH * 100, 0, 100) : clamp(value, 0, 100);
}

function normalizePinnedY(value: number): number {
  return value > 100 ? clamp(value / WORLD_HEIGHT * 100, 0, 100) : clamp(value, 0, 100);
}

function resolveSelectedNodeId(
  model: { byId: Record<string, AtlasNode>; nodes: AtlasNode[] },
  options: BuildRenderableGraphOptions
): string | null {
  if (options.selection?.kind === "node" && model.byId[options.selection.id]) return options.selection.id;
  if (options.selectedNodeId && model.byId[options.selectedNodeId]) return options.selectedNodeId;
  return null;
}

function firstPreviewNodeId(visible: { starts: Array<{ node: AtlasNode }>; nodes: AtlasNode[] }): string | null {
  const firstStart = visible.starts.find((entry) => entry?.node);
  if (firstStart?.node) return firstStart.node.id;
  const fallback = visible.nodes.slice().sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0];
  return fallback ? fallback.id : null;
}

function nodeDisplayMode(
  node: AtlasNode,
  densityMode: DensityMode,
  selectedNodeId: string | null,
  previewNodeId: string | null,
  labelNodeIds: Record<string, boolean>,
  importantNodeIds: Record<string, boolean>
): NodeDisplayMode {
  if (node.id === selectedNodeId) return "card";
  if (previewNodeId && node.id === previewNodeId && (densityMode === "overview" || densityMode === "point-plus-focus")) return "compact-card";
  if (importantNodeIds[node.id] && (densityMode === "overview" || densityMode === "point-plus-focus")) return "compact-card";
  if (densityMode === "overview") return labelNodeIds[node.id] ? "compact-card" : "overview";
  if (densityMode === "point-plus-focus") return labelNodeIds[node.id] ? "compact-card" : "point";
  return densityMode;
}

function nodeVisualRole(
  node: AtlasNode,
  displayMode: NodeDisplayMode,
  selectedNodeId: string | null,
  previewNodeId: string | null,
  importantNodeIds: Record<string, boolean>
): NodeVisualRole {
  if (node.id === selectedNodeId) return "cinnabar-note";
  if (displayMode === "point" || displayMode === "overview") return "map-pin";
  if (previewNodeId && node.id === previewNodeId) return "index-slip";
  if (importantNodeIds[node.id]) return "index-slip";
  return "landmark";
}

function computeCommunityWash(nodes: RenderableNode[]): RenderableCommunity["wash"] {
  if (!nodes.length) return null;
  const points = nodes.map((node) => node.point);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    cx: round((minX + maxX) / 2),
    cy: round((minY + maxY) / 2),
    rx: round(Math.max(54, (maxX - minX) / 2 + 46)),
    ry: round(Math.max(36, (maxY - minY) / 2 + 34)),
    opacity: nodes.length > 1 ? 0.11 : 0.06
  };
}

function edgeStrokeWidthRaw(weight: number | undefined): number {
  return 1.1 + clampWeight(weight) * 1.8;
}

function clampWeight(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.6;
  return clamp(numeric, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
