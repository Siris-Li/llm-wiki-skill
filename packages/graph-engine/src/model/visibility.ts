import type { NodeId } from "../types";

interface VisibilityNode {
  id: NodeId;
  degree?: unknown;
}

interface SearchableVisibilityNode extends VisibilityNode {
  label?: string;
  content?: string;
}

interface SearchIndexEntry<TNode extends VisibilityNode> {
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

export function applySearchToNodeIds<TNode extends VisibilityNode>(
  searchIndex: readonly SearchIndexEntry<TNode>[],
  query: unknown
): NodeId[] {
  if (!Array.isArray(searchIndex)) return [];
  const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  const matches = !normalizedQuery
    ? searchIndex
    : searchIndex.filter((entry) => (
      entry && typeof entry.haystack === "string" && entry.haystack.indexOf(normalizedQuery) !== -1
    ));
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
