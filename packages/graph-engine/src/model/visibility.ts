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
  degree?: unknown;
}

interface SearchableVisibilityNode extends VisibilityNode {
  label?: string;
  content?: string;
}

export interface SearchIndexEntry<TNode extends VisibilityNode> {
  node: TNode;
  haystack: string;
}

interface VisibilityLink {
  source: NodeId | { id?: NodeId };
  target: NodeId | { id?: NodeId };
  type?: string;
  weight?: unknown;
}

interface FocusModeOptions<TNode extends VisibilityNode, TLink extends VisibilityLink> {
  mode?: string;
  nodes?: readonly TNode[];
  links?: readonly TLink[];
  nodeIds?: readonly NodeId[];
  anchorNodeId?: NodeId | null;
  highConfidenceThreshold?: number;
  coreLimit?: number;
}

interface FocusModeResult<TLink extends VisibilityLink> {
  node_ids: NodeId[];
  links: TLink[];
}

interface VisibleSnapshotOptions<TNode extends SearchableVisibilityNode, TLink extends VisibilityLink> {
  nodes?: readonly TNode[];
  links?: readonly TLink[];
  baseNodeIds?: readonly NodeId[];
  filters?: Readonly<Record<string, boolean | undefined>>;
  focusMode?: string;
  searchQuery?: string;
  anchorNodeId?: NodeId | null;
  highConfidenceThreshold?: number;
  coreLimit?: number;
}

interface VisibleSnapshot<TNode extends SearchableVisibilityNode, TLink extends VisibilityLink> {
  node_ids: NodeId[];
  nodes: TNode[];
  links: TLink[];
  searchIndex: SearchIndexEntry<TNode>[];
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
    const keep = new Set(
      baseNodes.slice()
        .sort((left, right) => (right.priority || 0) - (left.priority || 0))
        .slice(0, keepCount)
        .map((node) => node.id)
    );
    if (selectedNodeId && model.byId[selectedNodeId]) keep.add(selectedNodeId);
    baseNodes = baseNodes.filter((node) => keep.has(node.id));
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
  const visibleIdSet = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = model.edges.filter((edge) => {
    const edgeType = edge.type || "EXTRACTED";
    if (filters[edgeType] === false) return false;
    return visibleIdSet.has(edge.source) && visibleIdSet.has(edge.target);
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

export function filterLinksByTypes<TLink extends VisibilityLink>(
  allLinks: readonly TLink[],
  filters?: Readonly<Record<string, boolean | undefined>> | null
): TLink[] {
  if (!Array.isArray(allLinks)) return [];
  if (!filters || typeof filters !== "object") return allLinks.slice();
  return allLinks.filter((link) => {
    const type = link?.type ? link.type : "EXTRACTED";
    return filters[type] !== false;
  });
}

export function applyFocusMode<TNode extends VisibilityNode, TLink extends VisibilityLink>(
  options?: FocusModeOptions<TNode, TLink> | null
): FocusModeResult<TLink> {
  const nodes = Array.isArray(options?.nodes) ? options.nodes : [];
  const links = Array.isArray(options?.links) ? options.links : [];
  const nodeIds = Array.isArray(options?.nodeIds) ? options.nodeIds.slice() : [];
  const mode = options?.mode || "all";
  const anchorNodeId = options?.anchorNodeId != null ? String(options.anchorNodeId) : null;
  const highConfidenceThreshold = Number.isFinite(Number(options?.highConfidenceThreshold))
    ? Number(options?.highConfidenceThreshold)
    : 0.75;
  const nodesById: Record<NodeId, TNode> = {};
  const idSet = new Set<NodeId>();

  for (const node of nodes) {
    if (node?.id != null) nodesById[node.id] = node;
  }
  for (const id of nodeIds) idSet.add(id);
  if (!nodeIds.length) return { node_ids: [], links: [] };

  const scopedLinks = getVisibleLinks(links, nodeIds);
  if (mode === "all") return { node_ids: nodeIds.slice(), links: scopedLinks };

  if (mode === "high_confidence") {
    const strongLinks = scopedLinks.filter((link) => {
      const weight = Number(link?.weight);
      return Number.isFinite(weight) && weight >= highConfidenceThreshold;
    });
    const strongIds = new Set<NodeId>();
    for (const link of strongLinks) {
      const endpoints = getLinkEndpointIds(link);
      if (idSet.has(endpoints.sourceId)) strongIds.add(endpoints.sourceId);
      if (idSet.has(endpoints.targetId)) strongIds.add(endpoints.targetId);
    }
    if (anchorNodeId && idSet.has(anchorNodeId)) strongIds.add(anchorNodeId);
    const strongNodeIds = nodeIds.filter((id) => strongIds.has(id));
    return { node_ids: strongNodeIds, links: getVisibleLinks(strongLinks, strongNodeIds) };
  }

  if (mode === "one_hop") {
    const hopAnchorNodeId = anchorNodeId && idSet.has(anchorNodeId) ? anchorNodeId : nodeIds[0] || null;
    if (!hopAnchorNodeId) return { node_ids: [], links: [] };
    const hopIds = new Set<NodeId>([hopAnchorNodeId]);
    for (const link of scopedLinks) {
      const endpoints = getLinkEndpointIds(link);
      if (endpoints.sourceId === hopAnchorNodeId && idSet.has(endpoints.targetId)) hopIds.add(endpoints.targetId);
      if (endpoints.targetId === hopAnchorNodeId && idSet.has(endpoints.sourceId)) hopIds.add(endpoints.sourceId);
    }
    const hopNodeIds = nodeIds.filter((id) => hopIds.has(id));
    return { node_ids: hopNodeIds, links: getVisibleLinks(scopedLinks, hopNodeIds) };
  }

  if (mode === "core") {
    if (nodeIds.length <= 3) return { node_ids: nodeIds.slice(), links: scopedLinks };
    const scores: Record<NodeId, number> = {};
    for (const id of nodeIds) scores[id] = 0;
    for (const link of scopedLinks) {
      const endpoints = getLinkEndpointIds(link);
      const weight = Number(link?.weight);
      const score = Number.isFinite(weight) ? 1 + weight : 1.5;
      if (scores[endpoints.sourceId] != null) scores[endpoints.sourceId] += score;
      if (scores[endpoints.targetId] != null) scores[endpoints.targetId] += score;
    }
    const requestedLimit = Number(options?.coreLimit);
    const defaultLimit = Math.max(3, Math.min(8, Math.round(nodeIds.length * 0.5)));
    const coreLimit = Math.max(
      1,
      Math.min(nodeIds.length, Math.round(Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit))
    );
    const coreNodeIds = sortNodeIdsByScore(nodeIds, scores, nodesById).slice(0, coreLimit);
    return { node_ids: coreNodeIds, links: getVisibleLinks(scopedLinks, coreNodeIds) };
  }

  return { node_ids: nodeIds.slice(), links: scopedLinks };
}

export function resolveVisibleSnapshot<TNode extends SearchableVisibilityNode, TLink extends VisibilityLink>(
  options?: VisibleSnapshotOptions<TNode, TLink> | null
): VisibleSnapshot<TNode, TLink> {
  const nodes = Array.isArray(options?.nodes) ? options.nodes : [];
  const links = Array.isArray(options?.links) ? options.links : [];
  const baseNodeIds = Array.isArray(options?.baseNodeIds)
    ? options.baseNodeIds.slice()
    : nodes.map((node) => node.id);
  const filteredLinks = filterLinksByTypes(links, options?.filters);
  const scopedLinks = getVisibleLinks(filteredLinks, baseNodeIds);
  const focusResult = applyFocusMode({
    mode: options?.focusMode,
    nodes,
    links: scopedLinks,
    nodeIds: baseNodeIds,
    anchorNodeId: options?.anchorNodeId,
    highConfidenceThreshold: options?.highConfidenceThreshold,
    coreLimit: options?.coreLimit
  });
  let focusNodeIds = focusResult.node_ids || [];
  if (!focusNodeIds.length && options?.focusMode && options.focusMode !== "all") {
    return { node_ids: [], nodes: [], links: [], searchIndex: [] };
  }
  if (!focusNodeIds.length) focusNodeIds = baseNodeIds;
  const focusNodeIdSet = new Set(focusNodeIds);
  const focusNodes = nodes.filter((node) => focusNodeIdSet.has(node.id));
  const searchIndex = buildSearchIndex(focusNodes);
  const query = typeof options?.searchQuery === "string" ? options.searchQuery.trim() : "";
  const finalNodeIds = query ? applySearchToNodeIds(searchIndex, query) : focusNodeIds;
  const finalNodeIdSet = new Set(finalNodeIds);
  return {
    node_ids: finalNodeIds,
    nodes: nodes.filter((node) => finalNodeIdSet.has(node.id)),
    links: finalNodeIds.length
      ? getVisibleLinks(focusResult.links.length ? focusResult.links : scopedLinks, finalNodeIds)
      : [],
    searchIndex
  };
}

export function shouldAutoOpenDrawer(mode: unknown): boolean {
  return mode === "path";
}

function getVisibleLinks<TLink extends VisibilityLink>(
  allLinks: readonly TLink[],
  visibleIds: readonly NodeId[]
): TLink[] {
  if (!visibleIds.length) return allLinks.slice();
  const visibleIdSet = new Set(visibleIds);
  return allLinks.filter((link) => {
    const endpoints = getLinkEndpointIds(link);
    return visibleIdSet.has(endpoints.sourceId) && visibleIdSet.has(endpoints.targetId);
  });
}

function getLinkEndpointIds(link: VisibilityLink): { sourceId: NodeId; targetId: NodeId } {
  return {
    sourceId: endpointId(link?.source),
    targetId: endpointId(link?.target)
  };
}

function endpointId(value: VisibilityLink["source"]): NodeId {
  return typeof value === "object" && value?.id ? value.id : value as NodeId;
}

function sortNodeIdsByScore<TNode extends VisibilityNode>(
  nodeIds: readonly NodeId[],
  scores: Readonly<Record<NodeId, number>>,
  nodesById: Readonly<Record<NodeId, TNode>>
): NodeId[] {
  return nodeIds.slice().sort((left, right) => {
    const scoreDiff = (scores[right] || 0) - (scores[left] || 0);
    if (scoreDiff) return scoreDiff;
    const leftDegree = Number.isFinite(Number(nodesById[left]?.degree)) ? Number(nodesById[left]?.degree) : 0;
    const rightDegree = Number.isFinite(Number(nodesById[right]?.degree)) ? Number(nodesById[right]?.degree) : 0;
    if (rightDegree !== leftDegree) return rightDegree - leftDegree;
    return String(left).localeCompare(String(right));
  });
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
