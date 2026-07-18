import type {
  GraphSummaryObjectRef,
  GraphTypeFilters,
  NodeId
} from "../types";
import type {
  AtlasEdge,
  AtlasModel,
  AtlasNode,
  AtlasSearchIndexEntry,
  AtlasVisibleState
} from "./atlas";

interface VisibilityNode {
  id: NodeId;
}

interface SearchableVisibilityNode extends VisibilityNode {
  label?: string;
  content?: string;
}

export interface SearchIndexEntry<TNode extends VisibilityNode> {
  node: TNode;
  haystack: string;
}

export function buildSearchHaystack(node: SearchableVisibilityNode): string {
  return `${node.label || node.id || ""}\n${(node.content || "").slice(0, 500)}`.toLowerCase();
}

export function buildSearchIndex<TNode extends SearchableVisibilityNode>(
  nodes: readonly TNode[]
): SearchIndexEntry<TNode>[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => ({ node, haystack: buildSearchHaystack(node) }));
}

export function buildRegularSearchIndex<TNode extends SearchableVisibilityNode>(
  nodes: readonly TNode[]
): SearchIndexEntry<TNode>[] {
  return buildSearchIndex(nodes);
}

export function applySearchToNodeIds<TNode extends VisibilityNode>(
  searchIndex: readonly SearchIndexEntry<TNode>[],
  query: unknown
): NodeId[] {
  if (!Array.isArray(searchIndex)) return [];
  const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  const matches = normalizedQuery ? matchingSearchEntries(searchIndex, normalizedQuery) : searchIndex;
  return matches
    .map((entry) => entry?.node?.id ?? null)
    .filter((id): id is NodeId => id != null);
}

export function resolveRegularSearchMatches<TNode extends VisibilityNode>(
  searchIndex: readonly SearchIndexEntry<TNode>[],
  query: unknown
): { query: string; matchIds: NodeId[] } {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  return {
    query: normalizedQuery,
    matchIds: normalizedQuery ? applySearchToNodeIds(searchIndex, normalizedQuery) : []
  };
}

export function resolveAtlasSearchMatches<TNode extends VisibilityNode>(
  searchIndex: readonly SearchIndexEntry<TNode>[],
  query: unknown
): { query: string; matchIds: NodeId[]; matches: TNode[] } {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  const matchingEntries = normalizedQuery
    ? matchingSearchEntries(searchIndex, normalizedQuery.toLowerCase())
    : [];
  return {
    query: normalizedQuery,
    matchIds: matchingEntries.map((entry) => entry.node.id),
    matches: matchingEntries.map((entry) => entry.node)
  };
}

export interface AtlasSemanticVisibilityOptions extends AtlasVisibleState {
  typeFilters?: GraphTypeFilters;
  temporaryObject?: GraphSummaryObjectRef | null;
}

export interface AtlasSemanticVisibility {
  node_ids: NodeId[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  contentNodes: AtlasNode[];
  typeFilters: GraphTypeFilters;
  searchIndex: AtlasSearchIndexEntry[];
  matchedNodeIds: Partial<Record<NodeId, boolean>>;
}

export interface AtlasVisibilityBase {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}

export function resolveAtlasSemanticVisibility(
  model: AtlasModel,
  options: AtlasSemanticVisibilityOptions = {}
): AtlasSemanticVisibility {
  const activeCommunityId = options.activeCommunityId == null ? "all" : String(options.activeCommunityId);
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const focusMode = options.focusMode || "all";
  const selectedNodeId = options.selectedNodeId == null ? null : String(options.selectedNodeId);
  const filters = options.filters && typeof options.filters === "object" ? options.filters : {};

  let baseNodes = model.nodes.filter((node) => {
    if (activeCommunityId !== "all" && node.community !== activeCommunityId) return false;
    if (focusMode === "source" && node.type !== "source") return false;
    return true;
  });

  if (focusMode === "core" && baseNodes.length > 8) {
    const keepCount = Math.max(8, Math.ceil(baseNodes.length * 0.45));
    const keep: Partial<Record<NodeId, boolean>> = {};
    baseNodes.slice()
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))
      .slice(0, keepCount)
      .forEach((node) => { keep[node.id] = true; });
    if (selectedNodeId && model.byId[selectedNodeId]) keep[selectedNodeId] = true;
    baseNodes = baseNodes.filter((node) => Boolean(keep[node.id]));
  }

  const baseNodeSet = new Set(baseNodes);
  const searchIndex = model.searchIndex.filter((entry) => baseNodeSet.has(entry.node));
  const atlasSearch = resolveAtlasSearchMatches(searchIndex, query);
  const matchedNodeIds: Partial<Record<NodeId, boolean>> = {};
  const visibleNodes = query
    ? atlasSearch.matches.map((node) => {
      matchedNodeIds[node.id] = true;
      return node;
    })
    : baseNodes;
  const visibleIdSet: Partial<Record<NodeId, boolean>> = {};
  visibleNodes.forEach((node) => { visibleIdSet[node.id] = true; });
  const visibleEdges = model.edges.filter((edge) => {
    const edgeType = edge.type || "EXTRACTED";
    if (filters[edgeType] === false) return false;
    return Boolean(visibleIdSet[edge.source] && visibleIdSet[edge.target]);
  });

  if (options.typeFilters === undefined && options.temporaryObject == null) {
    return {
      node_ids: visibleNodes.map((node) => node.id),
      nodes: visibleNodes,
      edges: visibleEdges,
      contentNodes: model.nodes.slice(),
      typeFilters: normalizeAtlasTypeFilters(undefined, model.nodes),
      searchIndex,
      matchedNodeIds
    };
  }

  const visibleSet = applyAtlasTypeAndTemporaryVisibility(model, { nodes: visibleNodes, edges: visibleEdges }, options);
  return { ...visibleSet, searchIndex, matchedNodeIds };
}

export function applyAtlasTypeAndTemporaryVisibility(
  model: AtlasModel,
  base: AtlasVisibilityBase,
  options: Pick<AtlasSemanticVisibilityOptions, "activeCommunityId" | "filters" | "typeFilters" | "temporaryObject"> = {}
): Omit<AtlasSemanticVisibility, "searchIndex" | "matchedNodeIds"> {
  const typeFilters = normalizeAtlasTypeFilters(options.typeFilters, model.nodes);
  const temporaryNodes = resolveAtlasTemporaryNodes(
    options.temporaryObject,
    model.nodes,
    options.activeCommunityId
  );
  const visibleNodeIds = new Set(
    base.nodes
      .filter((node) => typeFilters[node.type] !== false)
      .map((node) => node.id)
  );
  const temporaryNodeIds = new Set(temporaryNodes.map((node) => node.id));
  const nodes = model.nodes.filter((node) => visibleNodeIds.has(node.id) || temporaryNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const allowedEdges = model.edges.filter((edge) => {
    if (options.filters?.[edge.type || "EXTRACTED"] === false) return false;
    return nodeIds.has(edge.source) && nodeIds.has(edge.target);
  });
  const edges = mergeAtlasEdges(
    base.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    allowedEdges
  );

  return {
    node_ids: nodes.map((node) => node.id),
    nodes,
    edges,
    contentNodes: model.nodes.filter((node) => typeFilters[node.type] !== false || temporaryNodeIds.has(node.id)),
    typeFilters
  };
}

export function normalizeAtlasTypeFilters(
  filters: GraphTypeFilters | undefined,
  nodes: readonly AtlasNode[]
): GraphTypeFilters {
  const normalized: GraphTypeFilters = {};
  for (const node of nodes) normalized[node.type] = filters?.[node.type] !== false;
  return normalized;
}

export function resolveAtlasTemporaryNodes(
  object: GraphSummaryObjectRef | null | undefined,
  nodes: readonly AtlasNode[],
  activeCommunityId: string | null | undefined
): AtlasNode[] {
  if (!object) return [];
  const focusedCommunityId = activeCommunityId && activeCommunityId !== "all" ? activeCommunityId : null;
  if (object.kind === "node") return nodes.filter((node) => node.id === object.nodeId);
  if (object.kind === "aggregation") {
    const nodeIds = new Set(object.nodeIds);
    return nodes.filter((node) => nodeIds.has(node.id) && (!focusedCommunityId || node.community === focusedCommunityId));
  }
  if (focusedCommunityId && focusedCommunityId !== object.communityId) return [];
  return nodes.filter((node) => node.community === object.communityId);
}

function matchingSearchEntries<TNode extends VisibilityNode>(
  searchIndex: readonly SearchIndexEntry<TNode>[],
  normalizedQuery: string
): SearchIndexEntry<TNode>[] {
  return searchIndex.filter((entry) => (
    entry && typeof entry.haystack === "string" && entry.haystack.indexOf(normalizedQuery) !== -1
  ));
}

function mergeAtlasEdges(base: AtlasEdge[], extra: AtlasEdge[]): AtlasEdge[] {
  if (extra.length === 0) return base;
  const ids = new Set(base.map((edge) => edge.id));
  return [
    ...base,
    ...extra.filter((edge) => {
      if (ids.has(edge.id)) return false;
      ids.add(edge.id);
      return true;
    })
  ];
}
