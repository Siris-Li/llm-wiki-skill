import type {
  Community,
  CommunityId,
  EdgeId,
  GraphData,
  GraphEdge,
  GraphEdgeSignals,
  GraphInsights,
  GraphInsightsMeta,
  GraphLearning,
  GraphNode,
  GraphRelationType,
  NodeId,
  WikiPath
} from "../types";

import {
  atlasConfidenceLabel,
  atlasNodeKind,
  atlasTypeLabel,
  stripAtlasMarkdown
} from "./labels";

export {
  deriveAtlasLayout,
  resolveAtlasVisibleSnapshot,
  normalizeAtlasViewport,
  getAtlasModelBounds,
  clampAtlasViewport,
  fitAtlasViewport,
  centerAtlasViewportOnPoint,
  zoomAtlasViewport,
  atlasViewportRect,
  atlasPointToMinimap,
  minimapPointToAtlasPoint,
  atlasViewportToMinimapRect
} from './legacy-helpers';

export type AtlasNodeType = "entity" | "topic" | "source" | "comparison" | "synthesis" | "query";
export type AtlasNodeKind = "ENTITY" | "TOPIC" | "SOURCE" | "COMPARISON" | "SYNTHESIS" | "QUERY";
export type AtlasConfidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS" | "UNVERIFIED";
export type AtlasDensityMode = "card" | "compact-card" | "point-plus-focus" | "overview";

export interface AtlasNode {
  id: NodeId;
  label: string;
  type: AtlasNodeType;
  type_label: string;
  kind: AtlasNodeKind;
  community: CommunityId;
  source_path: WikiPath;
  confidence: AtlasConfidence;
  confidence_label: string;
  content: string;
  summary: string;
  unavailable: boolean;
  degree: number;
  weight: number;
  priority: number;
  idx: number;
  x: number | null;
  y: number | null;
}

export interface AtlasEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  from: NodeId;
  to: NodeId;
  /** Legacy confidence alias; the relationship meaning is stored in relation_type. */
  type: AtlasConfidence;
  confidence: AtlasConfidence;
  confidence_label: string;
  relation_type: GraphRelationType;
  weight: number;
  signals: GraphEdgeSignals;
  source_signal_available: boolean;
}

export interface AtlasCommunity {
  id: CommunityId;
  label: string;
  node_count: number;
  source_count: number;
  is_primary: boolean;
  recommended_start_node_id: NodeId | null;
  color_index: number;
}

export interface AtlasStart {
  node: AtlasNode;
  reason: string;
}

export interface AtlasSearchIndexEntry {
  node: AtlasNode;
  haystack: string;
}

export interface AtlasModelMeta {
  wiki_title: string;
  total_nodes: number;
  total_edges: number;
  build_date: string;
}

export interface AtlasInsights {
  surprising_connections: GraphInsights["surprising_connections"];
  isolated_nodes: GraphInsights["isolated_nodes"];
  bridge_nodes: GraphInsights["bridge_nodes"];
  sparse_communities: GraphInsights["sparse_communities"];
  meta: GraphInsightsMeta & Record<string, unknown>;
}

export interface AtlasModel {
  meta: AtlasModelMeta;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  byId: Record<NodeId, AtlasNode>;
  communities: AtlasCommunity[];
  communityById: Record<CommunityId, AtlasCommunity>;
  starts: AtlasStart[];
  searchIndex: AtlasSearchIndexEntry[];
  insights: AtlasInsights;
}

export interface AtlasPoint {
  x: number;
  y: number;
}

export interface AtlasLayout {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  nodePositions: Record<NodeId, AtlasPoint>;
}

export interface AtlasVisibleState {
  activeCommunityId?: CommunityId | null;
  query?: string;
  focusMode?: "all" | "source" | "core" | string;
  selectedNodeId?: NodeId | null;
  filters?: Record<string, boolean>;
}

export interface AtlasVisibleCounts {
  visible_nodes: number;
  visible_edges: number;
  total_nodes: number;
  total_edges: number;
  total_communities: number;
}

export interface AtlasVisibleSnapshot {
  node_ids: NodeId[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  links: AtlasEdge[];
  searchIndex: AtlasSearchIndexEntry[];
  densityMode: AtlasDensityMode;
  labelNodeIds: Record<NodeId, boolean>;
  matchedNodeIds: Record<NodeId, boolean>;
  importantNodeIds: Record<NodeId, boolean>;
  startNodeIds: Record<NodeId, boolean>;
  starts: AtlasStart[];
  counts: AtlasVisibleCounts;
}

interface AtlasCommunityGroup {
  id: CommunityId;
  nodes: AtlasNode[];
}

interface AtlasLearningCompatibility {
  entry: { recommended_start_node_id: unknown };
  communities: Record<string, unknown>[];
}

const ATLAS_NODE_TYPES = new Set<AtlasNodeType>([
  "entity",
  "topic",
  "source",
  "comparison",
  "synthesis",
  "query"
]);

const ATLAS_CONFIDENCES = new Set<AtlasConfidence>([
  "EXTRACTED",
  "INFERRED",
  "AMBIGUOUS",
  "UNVERIFIED"
]);

export function buildAtlasModel(input: unknown): AtlasModel {
  const raw = objectRecord(input);
  const nodes = mapArrayValues(raw.nodes, normalizeAtlasNode);
  const byId: Record<NodeId, AtlasNode> = Object.create(null) as Record<NodeId, AtlasNode>;
  const groupedByCommunity: Record<CommunityId, AtlasCommunityGroup> = Object.create(null) as Record<CommunityId, AtlasCommunityGroup>;

  nodes.forEach((node) => {
    byId[node.id] = node;
    const group = groupedByCommunity[node.community] ?? { id: node.community, nodes: [] };
    group.nodes.push(node);
    groupedByCommunity[node.community] = group;
  });

  const edges = mapArrayValues(raw.edges, normalizeAtlasEdge)
    .filter((edge) => Boolean(byId[edge.source] && byId[edge.target]));

  for (const edge of edges) {
    byId[edge.source]!.degree += 1;
    byId[edge.target]!.degree += 1;
  }
  nodes.forEach((node) => {
    node.priority = node.degree * 12 + node.weight + (node.type === "topic" ? 12 : node.type === "source" ? 6 : 0);
  });

  const communities = deriveAtlasCommunities(raw, groupedByCommunity);
  const communityById: Record<CommunityId, AtlasCommunity> = Object.create(null) as Record<CommunityId, AtlasCommunity>;
  for (const community of communities) communityById[community.id] = community;

  const rawMeta = objectRecord(raw.meta);
  return {
    meta: {
      wiki_title: rawMeta.wiki_title ? compatibleString(rawMeta.wiki_title, "知识库") : "知识库",
      total_nodes: nodes.length,
      total_edges: edges.length,
      build_date: rawMeta.build_date ? compatibleString(rawMeta.build_date, "") : ""
    },
    nodes,
    edges,
    byId,
    communities,
    communityById,
    starts: buildAtlasStarts(raw, nodes, byId, communities),
    searchIndex: buildAtlasSearchIndex(nodes),
    insights: normalizeAtlasModelInsights(raw.insights)
  };
}

export function resolveAtlasSelectedNodeId(
  model: AtlasModel,
  visibleSnapshot: AtlasVisibleSnapshot | null | undefined,
  selectedNodeId: unknown
): NodeId | null {
  const selected = selectedNodeId == null ? null : compatibleString(selectedNodeId, "");
  if (!selected || !model.byId[selected]) return null;
  if (!visibleSnapshot) return selected;
  return visibleSnapshot.node_ids.includes(selected) ? selected : null;
}

export function getAtlasDensityMode(count: unknown): AtlasDensityMode {
  const nodeCount = finiteNumber(count, 0);
  if (nodeCount > 500) return "overview";
  if (nodeCount > 200) return "point-plus-focus";
  if (nodeCount > 80) return "compact-card";
  return "card";
}

export function atlasNodePoint(node: Pick<AtlasNode, "x" | "y">): AtlasPoint {
  return {
    x: clampAtlasModelNumber(node.x, 50, 0, 100) / 100 * 1000,
    y: clampAtlasModelNumber(node.y, 50, 0, 100) / 100 * 680
  };
}

function normalizeAtlasNode(value: unknown, index: number): AtlasNode {
  const raw = objectRecord(value);
  const id = raw.id == null ? `node-${index}` : compatibleString(raw.id, `node-${index}`);
  const rawLabel = compatibleString(raw.label, "");
  const label = raw.label == null || rawLabel.trim() === "" ? id : rawLabel.trim();
  const content = compatibleString(raw.content, "");
  const type = normalizeAtlasType(raw.type);
  const confidence = normalizeAtlasConfidence(firstTruthy(raw.confidence, raw.type_confidence));
  const x = optionalFiniteCoordinate(raw.x);
  const y = optionalFiniteCoordinate(raw.y);
  return {
    id,
    label,
    type,
    type_label: compatibleString(atlasTypeLabel(type), "实体"),
    kind: atlasNodeKind(type) as AtlasNodeKind,
    community: raw.community == null || raw.community === "" ? "_none" : compatibleString(raw.community, "_none"),
    source_path: compatibleString(firstTruthy(raw.source_path, raw.source, raw.path), ""),
    confidence,
    confidence_label: compatibleString(atlasConfidenceLabel(confidence), "直接提取"),
    content,
    summary: deriveAtlasSummary(raw, content),
    unavailable: raw.unavailable === true || raw.available === false,
    degree: 0,
    weight: clampAtlasModelNumber(raw.weight != null ? raw.weight : raw.score, 50, 0, 100),
    priority: 0,
    idx: index,
    x,
    y
  };
}

function normalizeAtlasEdge(value: unknown, index: number): AtlasEdge {
  const raw = objectRecord(value);
  const source = atlasEndpointId(raw.from != null ? raw.from : raw.source);
  const target = atlasEndpointId(raw.to != null ? raw.to : raw.target);
  const confidence = normalizeAtlasConfidence(firstTruthy(raw.confidence, raw.type, raw.type_confidence));
  return {
    id: raw.id == null ? `edge-${index}` : compatibleString(raw.id, `edge-${index}`),
    source,
    target,
    from: source,
    to: target,
    type: confidence,
    confidence,
    confidence_label: compatibleString(atlasConfidenceLabel(confidence), "直接提取"),
    relation_type: normalizeAtlasRelationType(firstTruthy(raw.relation_type, raw.relationship_type, raw.relation)),
    weight: clampAtlasModelNumber(raw.weight, 0.6, 0, 1),
    signals: normalizeAtlasEdgeSignals(raw.signals),
    source_signal_available: raw.source_signal_available === true
  };
}

function deriveAtlasCommunities(
  rawGraph: Record<string, unknown>,
  groupedByCommunity: Record<CommunityId, AtlasCommunityGroup>
): AtlasCommunity[] {
  const learning = normalizeAtlasLearningCompatibility(rawGraph.learning);
  const communities: AtlasCommunity[] = [];
  const seen: Record<string, boolean> = Object.create(null) as Record<string, boolean>;

  for (const rawCommunity of learning.communities) {
    if (rawCommunity.id == null) continue;
    const id = compatibleString(rawCommunity.id, "");
    const derived = groupedByCommunity[id] ?? { nodes: [] };
    seen[id] = true;
    communities.push({
      id,
      label: compatibleString(firstTruthy(rawCommunity.label, id), id),
      node_count: finiteNumber(rawCommunity.node_count, derived.nodes.length),
      source_count: finiteNumber(rawCommunity.source_count, 0),
      is_primary: rawCommunity.is_primary === true,
      recommended_start_node_id: nullableTruthyString(rawCommunity.recommended_start_node_id),
      color_index: communities.length
    });
  }

  for (const id of Object.keys(groupedByCommunity).sort()) {
    if (seen[id]) continue;
    const group = groupedByCommunity[id]!;
    const topic = group.nodes.find((node) => node.type === "topic");
    communities.push({
      id,
      label: id === "_none" ? "未分组" : topic?.label || id,
      node_count: group.nodes.length,
      source_count: group.nodes.filter((node) => node.type === "source").length,
      is_primary: communities.length === 0,
      recommended_start_node_id: null,
      color_index: communities.length
    });
  }

  communities.sort((left, right) => {
    if (right.is_primary !== left.is_primary) return right.is_primary ? 1 : -1;
    if ((right.node_count || 0) !== (left.node_count || 0)) return (right.node_count || 0) - (left.node_count || 0);
    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  });
  communities.forEach((community, index) => {
    community.color_index = index;
  });
  return communities;
}

function buildAtlasStarts(
  rawGraph: Record<string, unknown>,
  nodes: AtlasNode[],
  byId: Record<NodeId, AtlasNode>,
  communities: AtlasCommunity[]
): AtlasStart[] {
  const starts: AtlasStart[] = [];
  const seen: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  const add = (value: unknown, reason: string): void => {
    if (value == null) return;
    const id = compatibleString(value, "");
    if (!byId[id] || seen[id]) return;
    seen[id] = true;
    starts.push({ node: byId[id], reason });
  };

  const learning = normalizeAtlasLearningCompatibility(rawGraph.learning);
  add(learning.entry.recommended_start_node_id, "全局推荐起点");
  for (const community of communities) {
    add(community.recommended_start_node_id, `${community.label} · 推荐起点`);
  }
  nodes.slice().sort((left, right) => (right.priority || 0) - (left.priority || 0)).forEach((node) => {
    if (starts.length < 6) {
      add(node.id, `${atlasTypeLabel(node.type)} · ${atlasConfidenceLabel(node.confidence)}`);
    }
  });
  return starts.slice(0, 6);
}

function buildAtlasSearchIndex(nodes: AtlasNode[]): AtlasSearchIndexEntry[] {
  return nodes.map((node) => ({
    node,
    haystack: [
      node.label,
      node.id,
      node.type_label,
      node.source_path,
      node.summary,
      stripAtlasMarkdown(node.content)
    ].join("\n").toLowerCase()
  }));
}

function normalizeAtlasModelInsights(value: unknown): AtlasInsights {
  const raw = objectRecord(value);
  const rawMeta = objectRecord(raw.meta);
  return {
    surprising_connections: objectArray(raw.surprising_connections).map((item) => ({
      ...item,
      from: compatibleString(item.from, ""),
      to: compatibleString(item.to, ""),
      weight: finiteNumber(item.weight, 0),
      from_community: nullableString(item.from_community),
      to_community: nullableString(item.to_community)
    })),
    isolated_nodes: objectArray(raw.isolated_nodes).map((item) => ({
      ...item,
      id: compatibleString(item.id, ""),
      label: compatibleString(item.label, compatibleString(item.id, "")),
      degree: finiteNumber(item.degree, 0),
      community: nullableString(item.community)
    })),
    bridge_nodes: objectArray(raw.bridge_nodes).map((item) => ({
      ...item,
      id: compatibleString(item.id, ""),
      label: compatibleString(item.label, compatibleString(item.id, "")),
      community: nullableString(item.community),
      connected_communities: arrayValues(item.connected_communities).map((id) => compatibleString(id, "")),
      community_count: finiteNumber(item.community_count, 0)
    })),
    sparse_communities: objectArray(raw.sparse_communities).map((item) => ({
      ...item,
      id: compatibleString(item.id, ""),
      label: compatibleString(item.label, compatibleString(item.id, "")),
      node_count: finiteNumber(item.node_count, 0),
      density: finiteNumber(item.density, 0),
      members: arrayValues(item.members).map((id) => compatibleString(id, "")),
      internal_edges: finiteNumber(item.internal_edges, 0)
    })),
    meta: {
      ...rawMeta,
      degraded: rawMeta.degraded === true,
      node_count: finiteNumber(rawMeta.node_count, 0),
      edge_count: finiteNumber(rawMeta.edge_count, 0),
      max_insight_nodes: finiteNumber(rawMeta.max_insight_nodes, 0),
      max_insight_edges: finiteNumber(rawMeta.max_insight_edges, 0)
    }
  };
}

function normalizeAtlasLearningCompatibility(value: unknown): AtlasLearningCompatibility {
  const raw = objectRecord(value);
  const entry = objectRecord(raw.entry);
  return {
    entry: { recommended_start_node_id: entry.recommended_start_node_id ?? null },
    communities: objectArray(raw.communities)
  };
}

function normalizeAtlasType(value: unknown): AtlasNodeType {
  const normalized = compatibleString(firstTruthy(value, "entity"), "entity").toLowerCase() as AtlasNodeType;
  return ATLAS_NODE_TYPES.has(normalized) ? normalized : "entity";
}

function normalizeAtlasConfidence(value: unknown): AtlasConfidence {
  const normalized = compatibleString(firstTruthy(value, "EXTRACTED"), "EXTRACTED").toUpperCase() as AtlasConfidence;
  return ATLAS_CONFIDENCES.has(normalized) ? normalized : "EXTRACTED";
}

function normalizeAtlasRelationType(value: unknown): GraphRelationType {
  const normalized = compatibleString(firstTruthy(value, "依赖"), "依赖").trim();
  return normalized || "依赖";
}

function deriveAtlasSummary(raw: Record<string, unknown>, content: string): string {
  const explicit = raw.summary == null ? "" : compatibleString(raw.summary, "").trim();
  if (explicit) return explicit.length > 170 ? `${explicit.slice(0, 170).trim()}…` : explicit;
  const source = compatibleString(firstTruthy(content, raw.content), "").replace(/^#\s+.*(?:\r?\n)+/, "");
  const stripped = stripAtlasMarkdown(source);
  if (!stripped) return "";
  return stripped.length > 170 ? `${stripped.slice(0, 170).trim()}…` : stripped;
}

function atlasEndpointId(value: unknown): NodeId {
  const endpoint = objectRecord(value);
  if (endpoint.id != null) return compatibleString(endpoint.id, "");
  return value == null ? "" : compatibleString(value, "");
}

function optionalFiniteCoordinate(value: unknown): number | null {
  const present = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  if (!present) return null;
  const numeric = finiteNumber(value, Number.NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampAtlasModelNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function nullableTruthyString(value: unknown): string | null {
  if (!value) return null;
  return compatibleString(value, "") || null;
}

function firstTruthy(...values: unknown[]): unknown {
  return values.find(Boolean);
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return arrayValues(value)
    .filter((entry) => entry != null && typeof entry === "object")
    .map((entry) => objectRecord(entry));
}

function normalizeAtlasEdgeSignals(value: unknown): GraphEdgeSignals {
  const normalized: GraphEdgeSignals = {};
  for (const [key, signal] of Object.entries(objectRecord(value))) {
    if (
      signal == null
      || typeof signal === "number"
      || typeof signal === "boolean"
      || typeof signal === "string"
    ) {
      normalized[key] = signal;
    }
  }
  return normalized;
}

export interface RegularSearchNodeProjection {
  node: GraphNode;
  haystack: string;
}

export interface GraphInputProjection {
  data: GraphData;
  regularSearchByNode: RegularSearchNodeProjection[];
}

export function projectGraphInput(input: unknown): GraphInputProjection {
  try {
    return projectGraphInputUnchecked(input);
  } catch {
    return projectGraphInputUnchecked({});
  }
}

function projectGraphInputUnchecked(input: unknown): GraphInputProjection {
  const rawGraph = { ...objectRecord(input) };
  const rawNodes = arrayValues(rawGraph.nodes);
  const nodes = rawNodes.map(projectNode);
  const rawEdges = arrayValues(rawGraph.edges);
  const edges = rawEdges.map(projectEdge);
  const rawMeta = objectRecord(rawGraph.meta);
  const learning = rawGraph.learning == null ? undefined : projectLearning(rawGraph.learning);
  const insights = rawGraph.insights == null ? undefined : projectInsights(rawGraph.insights);
  const data = {
    ...rawGraph,
    meta: {
      ...rawMeta,
      build_date: compatibleString(rawMeta.build_date, ""),
      wiki_title: compatibleString(rawMeta.wiki_title, "知识库"),
      total_nodes: compatibleCount(rawMeta.total_nodes, nodes.length),
      total_edges: compatibleCount(rawMeta.total_edges, edges.length)
    },
    nodes,
    edges,
    ...(learning ? { learning } : {}),
    ...(insights ? { insights } : {})
  } as GraphData;

  return {
    data,
    regularSearchByNode: nodes.map((node, index) => ({
      node,
      haystack: regularSearchHaystack(objectRecord(rawNodes[index]), node.id)
    }))
  };
}

function projectNode(value: unknown, index: number): GraphNode {
  const raw = objectRecord(value);
  const node = {
    ...raw,
    id: raw.id == null ? `node-${index}` : compatibleString(raw.id, `node-${index}`)
  } as Record<string, unknown>;
  copyCompatibleStrings(node, raw, [
    "label",
    "type",
    "community",
    "source_path",
    "source",
    "path",
    "content",
    "summary",
    "date",
    "updated_at",
    "updatedAt",
    "created_at",
    "createdAt",
    "source_title",
    "source_url",
    "url",
    "author",
    "source_name",
    "confidence",
    "type_confidence"
  ]);
  copyCompatibleNumbers(node, raw, ["x", "y", "weight", "score"]);
  return node as GraphNode;
}

function projectEdge(value: unknown, index: number): GraphEdge {
  const raw = objectRecord(value);
  const from = endpointId(raw.from != null ? raw.from : raw.source);
  const to = endpointId(raw.to != null ? raw.to : raw.target);
  const edge = {
    ...raw,
    id: raw.id == null ? `edge-${index}` : compatibleString(raw.id, `edge-${index}`),
    from,
    to,
    type: compatibleString(raw.type ?? raw.confidence ?? raw.type_confidence, "UNVERIFIED")
  } as Record<string, unknown>;
  copyCompatibleStrings(edge, raw, [
    "confidence",
    "type_confidence",
    "relation_type",
    "relationship_type",
    "relation"
  ]);
  copyCompatibleNumbers(edge, raw, ["weight"]);
  return edge as GraphEdge;
}

function projectLearning(value: unknown): GraphLearning {
  const raw = objectRecord(value);
  const entry = objectRecord(raw.entry);
  const views = objectRecord(raw.views);
  const pathView = objectRecord(views.path);
  const communityView = objectRecord(views.community);
  const globalView = objectRecord(views.global);
  const degraded = objectRecord(raw.degraded);
  const communities = Array.isArray(raw.communities)
    ? arrayValues(raw.communities).flatMap((community) => projectCommunity(community))
    : [];
  return {
    version: compatibleCount(raw.version, 1),
    entry: {
      recommended_start_node_id: compatibleNullableString(entry.recommended_start_node_id),
      recommended_start_reason: compatibleNullableString(entry.recommended_start_reason),
      default_mode: compatibleString(entry.default_mode, "global")
    },
    views: {
      path: {
        enabled: presentValue(pathView.enabled, false),
        start_node_id: compatibleNullableString(pathView.start_node_id),
        node_ids: compatibleStringArray(pathView.node_ids),
        degraded: presentValue(pathView.degraded, true)
      },
      community: {
        enabled: presentValue(communityView.enabled, false),
        community_id: compatibleNullableString(communityView.community_id),
        label: compatibleNullableString(communityView.label),
        node_ids: compatibleStringArray(communityView.node_ids),
        is_weak: presentValue(communityView.is_weak, false),
        degraded: presentValue(communityView.degraded, true)
      },
      global: {
        enabled: presentValue(globalView.enabled, true),
        node_ids: compatibleStringArray(globalView.node_ids),
        degraded: presentValue(globalView.degraded, false)
      }
    },
    communities,
    degraded: {
      path_to_community: presentValue(degraded.path_to_community, true),
      community_to_global: presentValue(degraded.community_to_global, true)
    }
  } as GraphLearning;
}

function projectCommunity(value: unknown): Community[] {
  const raw = objectRecord(value);
  if (raw.id == null) return [];
  return [{
    ...raw,
    id: compatibleString(raw.id, ""),
    label: compatibleString(raw.label, compatibleString(raw.id, "")),
    node_count: compatibleCount(raw.node_count, 0),
    source_count: compatibleCount(raw.source_count, 0),
    recommended_start_node_id: compatibleNullableString(raw.recommended_start_node_id)
  } as Community];
}

function projectInsights(value: unknown): GraphInsights {
  const raw = objectRecord(value);
  const meta = objectRecord(raw.meta);
  return {
    surprising_connections: objectEntries(raw.surprising_connections).map((item) => ({
      ...item,
      from: compatibleString(item.from, ""),
      to: compatibleString(item.to, ""),
      weight: compatibleNumber(item.weight, 0),
      from_community: nullableString(item.from_community),
      to_community: nullableString(item.to_community)
    })),
    isolated_nodes: objectEntries(raw.isolated_nodes).map((item) => ({
      ...item,
      id: compatibleString(item.id, ""),
      label: compatibleString(item.label, compatibleString(item.id, "")),
      degree: compatibleCount(item.degree, 0),
      community: nullableString(item.community)
    })),
    bridge_nodes: objectEntries(raw.bridge_nodes).map((item) => ({
      ...item,
      id: compatibleString(item.id, ""),
      label: compatibleString(item.label, compatibleString(item.id, "")),
      community: nullableString(item.community),
      connected_communities: Array.isArray(item.connected_communities)
        ? item.connected_communities.map((id) => compatibleString(id, ""))
        : [],
      community_count: compatibleCount(item.community_count, 0)
    })),
    sparse_communities: objectEntries(raw.sparse_communities).map((item) => ({
      ...item,
      id: compatibleString(item.id, ""),
      label: compatibleString(item.label, compatibleString(item.id, "")),
      node_count: compatibleCount(item.node_count, 0),
      density: compatibleNumber(item.density, 0),
      members: Array.isArray(item.members) ? item.members.map((id) => compatibleString(id, "")) : [],
      internal_edges: compatibleCount(item.internal_edges, 0)
    })),
    meta: {
      ...meta,
      degraded: meta.degraded === true,
      node_count: compatibleCount(meta.node_count, 0),
      edge_count: compatibleCount(meta.edge_count, 0),
      max_insight_nodes: compatibleCount(meta.max_insight_nodes, 0),
      max_insight_edges: compatibleCount(meta.max_insight_edges, 0)
    }
  };
}

function objectEntries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? arrayValues(value).filter((entry) => entry != null && typeof entry === "object").map((entry) => objectRecord(entry))
    : [];
}

function regularSearchHaystack(rawNode: Record<string, unknown>, fallbackId: string): string {
  const title = rawNode.label || fallbackId || "";
  const content = rawNode.content || "";
  return `${compatibleString(title, "")}\n${compatibleString(content, "").slice(0, 500)}`.toLowerCase();
}

function endpointId(value: unknown): string {
  const endpoint = objectRecord(value);
  if (endpoint.id != null) return compatibleString(endpoint.id, "");
  return value == null ? "" : compatibleString(value, "");
}

function compatibleCount(value: unknown, fallback: number): number {
  return finiteNumber(value, fallback);
}

function compatibleNumber(value: unknown, fallback: number): number {
  return finiteNumber(value, fallback);
}

function finiteNumber(value: unknown, fallback: number): number {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function nullableString(value: unknown): string | null {
  return value == null || value === "" ? null : compatibleString(value, "");
}

function compatibleNullableString(value: unknown): string | null {
  return value == null ? null : compatibleString(value, "") || null;
}

function compatibleStringArray(value: unknown): string[] {
  return arrayValues(value).map((item) => compatibleString(item, ""));
}

function presentValue<T>(value: unknown, fallback: T): T {
  return (value == null ? fallback : value) as T;
}

function compatibleString(value: unknown, fallback: string): string {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") return {};
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  try {
    for (const key of Object.keys(value)) {
      try {
        output[key] = (value as Record<string, unknown>)[key];
      } catch {
        // A hostile field is omitted while the rest of the object remains usable.
      }
    }
  } catch {
    return {};
  }
  return output;
}

function arrayValues(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const output: unknown[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      try {
        output.push(value[index]);
      } catch {
        output.push(undefined);
      }
    }
  } catch {
    return [];
  }
  return output;
}

function mapArrayValues<T>(value: unknown, mapper: (entry: unknown, index: number) => T): T[] {
  try {
    if (!Array.isArray(value)) return [];
    const output = new Array<T>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      try {
        if (!(index in value)) continue;
        output[index] = mapper(value[index], index);
      } catch {
        output[index] = mapper(undefined, index);
      }
    }
    return output;
  } catch {
    return [];
  }
}

function copyCompatibleStrings(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[]
): void {
  for (const key of keys) {
    if (source[key] != null) target[key] = compatibleString(source[key], "");
  }
}

function copyCompatibleNumbers(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: string[]
): void {
  for (const key of keys) {
    if (source[key] != null) target[key] = compatibleNumericInput(source[key]);
  }
}

function compatibleNumericInput(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  try {
    return Number(value);
  } catch {
    return undefined;
  }
}
