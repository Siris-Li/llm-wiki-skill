import type {
  CommunityId,
  GraphData,
  GraphDiff,
  GraphEdge,
  GraphMigrationWarning,
  GraphNode,
  NodeId,
} from "./types";

const MIN_COMMUNITY_MATCH_JACCARD = 0.5;

interface CommunityGroup {
  id: CommunityId;
  members: Set<string>;
}

interface IndexedEdge {
  edge: GraphEdge;
  index: number;
}

export function alignGraphIdentityBySourcePath(previous: GraphData, next: GraphData): {
  previousToNext: Map<NodeId, NodeId>;
  warnings: GraphMigrationWarning[];
} {
  const previousByPath = nodesBySourcePath(previous.nodes);
  const nextByPath = nodesBySourcePath(next.nodes);
  const previousToNext = new Map<NodeId, NodeId>();
  const usedNext = new Set<NodeId>();
  const warnings: GraphMigrationWarning[] = [];

  for (const [sourcePath, previousNodes] of previousByPath) {
    const nextNodes = nextByPath.get(sourcePath) ?? [];
    if (nextNodes.length === 0) continue;
    if (previousNodes.length === 1 && nextNodes.length === 1) {
      previousToNext.set(previousNodes[0]!.id, nextNodes[0]!.id);
      usedNext.add(nextNodes[0]!.id);
      continue;
    }
    warnings.push({
      code: "identity_alignment_ambiguous",
      source_path: sourcePath,
      previous_ids: previousNodes.map((node) => node.id),
      next_ids: nextNodes.map((node) => node.id),
    });
  }

  const nextIds = new Set(next.nodes.map((node) => node.id));
  for (const previousNode of previous.nodes) {
    if (previousToNext.has(previousNode.id)) continue;
    if (!nextIds.has(previousNode.id) || usedNext.has(previousNode.id)) continue;
    previousToNext.set(previousNode.id, previousNode.id);
    usedNext.add(previousNode.id);
  }

  return { previousToNext, warnings };
}

export function diffGraphData(previous: GraphData, next: GraphData): GraphDiff {
  const identityAlignment = alignGraphIdentityBySourcePath(previous, next);
  const mappedPreviousIds = new Set(identityAlignment.previousToNext.values());
  const addedNodes = next.nodes
    .map((node) => node.id)
    .filter((id) => !mappedPreviousIds.has(id));
  const removedNodes = previous.nodes
    .map((node) => node.id)
    .filter((id) => !identityAlignment.previousToNext.has(id));

  const mapPreviousNode = (id: NodeId): NodeId | null => identityAlignment.previousToNext.get(id) ?? null;
  const alignedCommunities = alignCommunities(previous, next, mapPreviousNode);
  const edgeDiff = diffSemanticEdges(previous.edges, next.edges, mapPreviousNode);
  const recoloredNodes = recoloredExistingNodes(
    previous,
    next,
    identityAlignment.previousToNext,
    alignedCommunities,
  );

  return {
    addedNodes,
    removedNodes,
    recoloredNodes,
    addedEdges: edgeDiff.addedEdges,
    removedEdges: edgeDiff.removedEdges,
    newCommunities: alignedCommunities.newCommunities,
    migrationWarnings: [...identityAlignment.warnings, ...edgeDiff.warnings],
    stats: {
      nodeCount: next.nodes.length,
      edgeCount: next.edges.length,
      communityCount: communityGroups(next, (id) => id, false).length,
    },
  };
}

function normalizeMigrationSourcePath(value: unknown): string | null {
  if (value == null) return null;
  let sourcePath: string;
  try {
    sourcePath = String(value).replaceAll("\\", "/");
  } catch {
    return null;
  }
  if (!sourcePath || sourcePath.startsWith("/") || /^[A-Za-z]:\//.test(sourcePath)) return null;

  const segments: string[] = [];
  for (const segment of sourcePath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function nodesBySourcePath(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const byPath = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const sourcePath = normalizeMigrationSourcePath(node.source_path);
    if (!sourcePath) continue;
    const group = byPath.get(sourcePath) ?? [];
    group.push(node);
    byPath.set(sourcePath, group);
  }
  return byPath;
}

function diffSemanticEdges(
  previous: GraphEdge[],
  next: GraphEdge[],
  mapPreviousNode: (id: NodeId) => NodeId | null,
): {
  addedEdges: string[];
  removedEdges: string[];
  warnings: GraphMigrationWarning[];
} {
  const previousBuckets = edgeBuckets(previous, mapPreviousNode, true);
  const nextBuckets = edgeBuckets(next, (id) => id, false);
  const matchedPrevious = new Set<number>();
  const matchedNext = new Set<number>();
  const warnings: GraphMigrationWarning[] = [];

  for (const [key, previousRows] of previousBuckets) {
    const nextRows = nextBuckets.get(key) ?? [];
    const matchCount = Math.min(previousRows.length, nextRows.length);
    for (let index = 0; index < matchCount; index += 1) {
      matchedPrevious.add(previousRows[index]!.index);
      matchedNext.add(nextRows[index]!.index);
    }
    if (previousRows.length > 1 || nextRows.length > 1) {
      warnings.push({
        code: "legacy_semantic_edge_duplicate",
        semantic_key: semanticEdgeWarningKey(previousRows[0]!.edge, mapPreviousNode),
        previous_edge_ids: previousRows.map(({ edge }) => edge.id),
        next_edge_ids: nextRows.map(({ edge }) => edge.id),
      });
    }
  }

  return {
    addedEdges: next.filter((_, index) => !matchedNext.has(index)).map((edge) => edge.id),
    removedEdges: previous.filter((_, index) => !matchedPrevious.has(index)).map((edge) => edge.id),
    warnings,
  };
}

function semanticEdgeWarningKey(
  edge: GraphEdge,
  mapNode: (id: NodeId) => NodeId | null,
): string {
  return JSON.stringify([
    mapNode(edge.from) ?? edge.from,
    mapNode(edge.to) ?? edge.to,
    edge.relation_type == null || edge.relation_type === "" ? "依赖" : String(edge.relation_type),
  ]);
}

function edgeBuckets(
  edges: GraphEdge[],
  mapNode: (id: NodeId) => NodeId | null,
  tagUnmatchedPrevious: boolean,
): Map<string, IndexedEdge[]> {
  const buckets = new Map<string, IndexedEdge[]>();
  edges.forEach((edge, index) => {
    const key = semanticEdgeKey(edge, mapNode, tagUnmatchedPrevious);
    const bucket = buckets.get(key) ?? [];
    bucket.push({ edge, index });
    buckets.set(key, bucket);
  });
  return buckets;
}

function semanticEdgeKey(
  edge: GraphEdge,
  mapNode: (id: NodeId) => NodeId | null,
  tagUnmatchedPrevious: boolean,
): string {
  const from = mapNode(edge.from);
  const to = mapNode(edge.to);
  return JSON.stringify([
    [from == null && tagUnmatchedPrevious ? "previous-unmatched" : "mapped", from ?? edge.from],
    [to == null && tagUnmatchedPrevious ? "previous-unmatched" : "mapped", to ?? edge.to],
    edge.relation_type == null || edge.relation_type === "" ? "依赖" : String(edge.relation_type),
  ]);
}

function recoloredExistingNodes(
  previous: GraphData,
  next: GraphData,
  previousToNext: Map<NodeId, NodeId>,
  alignment: { nextToPrevious: Map<CommunityId, CommunityId> },
): GraphDiff["recoloredNodes"] {
  const previousByNextId = new Map<NodeId, GraphNode>();
  for (const previousNode of previous.nodes) {
    const nextId = previousToNext.get(previousNode.id);
    if (nextId != null) previousByNextId.set(nextId, previousNode);
  }

  const result: GraphDiff["recoloredNodes"] = [];
  for (const nextNode of next.nodes) {
    const previousNode = previousByNextId.get(nextNode.id);
    if (!previousNode) continue;
    const previousCommunity = communityForNode(previousNode);
    const nextCommunity = communityForNode(nextNode);
    if (!previousCommunity || !nextCommunity) continue;
    const alignedNextCommunity = alignment.nextToPrevious.get(nextCommunity);
    if (!alignedNextCommunity || previousCommunity === alignedNextCommunity) continue;
    result.push({ id: nextNode.id, from: previousCommunity, to: nextCommunity });
  }
  return result;
}

function alignCommunities(
  previous: GraphData,
  next: GraphData,
  mapPreviousNode: (id: NodeId) => NodeId | null,
): {
  nextToPrevious: Map<CommunityId, CommunityId>;
  newCommunities: CommunityId[];
} {
  const previousGroups = communityGroups(previous, mapPreviousNode, true);
  const nextGroups = communityGroups(next, (id) => id, false);
  const pairs: Array<{ previous: CommunityId; next: CommunityId; score: number }> = [];
  for (const previousGroup of previousGroups) {
    for (const nextGroup of nextGroups) {
      const score = jaccard(previousGroup.members, nextGroup.members);
      if (score >= MIN_COMMUNITY_MATCH_JACCARD) {
        pairs.push({ previous: previousGroup.id, next: nextGroup.id, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.previous.localeCompare(b.previous) || a.next.localeCompare(b.next));

  const usedPrevious = new Set<CommunityId>();
  const usedNext = new Set<CommunityId>();
  const nextToPrevious = new Map<CommunityId, CommunityId>();
  for (const pair of pairs) {
    if (usedPrevious.has(pair.previous) || usedNext.has(pair.next)) continue;
    usedPrevious.add(pair.previous);
    usedNext.add(pair.next);
    nextToPrevious.set(pair.next, pair.previous);
  }

  const newCommunities = nextGroups
    .map((group) => group.id)
    .filter((id) => !nextToPrevious.has(id));
  return { nextToPrevious, newCommunities };
}

function communityGroups(
  data: GraphData,
  mapNode: (id: NodeId) => NodeId | null,
  tagUnmatchedPrevious: boolean,
): CommunityGroup[] {
  const groups = new Map<CommunityId, Set<string>>();
  for (const node of data.nodes) {
    const community = communityForNode(node);
    if (!community) continue;
    const members = groups.get(community) ?? new Set<string>();
    const mapped = mapNode(node.id);
    members.add(JSON.stringify([
      mapped == null && tagUnmatchedPrevious ? "previous-unmatched" : "mapped",
      mapped ?? node.id,
    ]));
    groups.set(community, members);
  }
  return Array.from(groups.entries()).map(([id, members]) => ({ id, members }));
}

function communityForNode(node: GraphNode): CommunityId | null {
  if (node.community == null || node.community === "") return null;
  return String(node.community);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const id of left) {
    if (right.has(id)) intersection += 1;
  }
  const unionSize = new Set([...left, ...right]).size;
  return unionSize === 0 ? 0 : intersection / unionSize;
}
