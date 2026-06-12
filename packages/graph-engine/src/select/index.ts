import type {
  CommunityId,
  EdgeId,
  GraphData,
  GraphEdge,
  GraphNode,
  NodeId,
  Selection,
  SelectionAction,
  SelectionFacts,
  SelectionInput
} from "../types";

interface SelectionNode {
  id: NodeId;
  label: string;
  community: CommunityId;
  sourcePath: string;
}

interface SelectionEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
}

interface SelectionGraphIndex {
  nodes: SelectionNode[];
  nodeById: Map<NodeId, SelectionNode>;
  edges: SelectionEdge[];
  neighborsById: Map<NodeId, Set<NodeId>>;
}

const ACTIONS = {
  summarizeCluster: { id: "summarize_cluster", label: "总结这一簇", tone: "digest" },
  findKnowledgeGaps: { id: "find_knowledge_gaps", label: "找知识缺口", tone: "lint" },
  createTopicPage: { id: "create_topic_page", label: "生成主题页", tone: "write" },
  whyNoConnection: { id: "why_no_connection", label: "为什么没联系", tone: "bridge" },
  findPotentialBridges: { id: "find_potential_bridges", label: "找潜在桥梁", tone: "bridge" },
  compareCommunities: { id: "compare_communities", label: "对比这两块", tone: "compare" },
  explorePotentialLinks: { id: "explore_potential_links", label: "探索潜在联系", tone: "bridge" },
  compareDifferences: { id: "compare_differences", label: "对比异同", tone: "compare" },
  linkIsland: { id: "link_island", label: "把它链入知识库", tone: "repair" }
} satisfies Record<string, SelectionAction>;

export function resolveSelection(data: GraphData, input: SelectionInput): Selection {
  const index = buildSelectionGraphIndex(data);
  const nodeIds = selectionNodeIds(index, input);
  const facts = selectionFacts(index, nodeIds);
  const communityIds = selectedCommunityIds(index, nodeIds);
  return {
    id: selectionId(input, nodeIds),
    nodeIds,
    communityIds,
    facts,
    actions: selectionActions(facts)
  };
}

export function selectionActions(facts: SelectionFacts): SelectionAction[] {
  if (facts.pageCount === 0) return [];
  if (facts.pageCount === 1 && facts.isolatedCount === 1) return [ACTIONS.linkIsland];
  if (facts.communityCount === 1 && facts.internalLinkCount > 0) {
    return [ACTIONS.summarizeCluster, ACTIONS.findKnowledgeGaps, ACTIONS.createTopicPage];
  }
  if (facts.communityCount === 2) {
    return [ACTIONS.whyNoConnection, ACTIONS.findPotentialBridges, ACTIONS.compareCommunities];
  }
  if (facts.pageCount > 1 && facts.internalLinkCount === 0) {
    return [ACTIONS.explorePotentialLinks, ACTIONS.compareDifferences];
  }
  if (facts.pageCount > 1) {
    return [ACTIONS.explorePotentialLinks, ACTIONS.compareDifferences];
  }
  return [ACTIONS.explorePotentialLinks];
}

function buildSelectionGraphIndex(data: GraphData): SelectionGraphIndex {
  const nodes = data.nodes.map(toSelectionNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const neighborsById = new Map(nodes.map((node) => [node.id, new Set<NodeId>()]));
  const edges: SelectionEdge[] = [];
  for (const edge of data.edges) {
    const source = endpointId(edge.from);
    const target = endpointId(edge.to);
    if (!source || !target || source === target || !nodeById.has(source) || !nodeById.has(target)) continue;
    const normalized = { id: edge.id || `${source}->${target}`, source, target };
    edges.push(normalized);
    neighborsById.get(source)?.add(target);
    neighborsById.get(target)?.add(source);
  }
  return { nodes, nodeById, edges, neighborsById };
}

function selectionNodeIds(index: SelectionGraphIndex, input: SelectionInput): NodeId[] {
  if (input.kind === "node") return index.nodeById.has(input.id) ? [input.id] : [];
  if (input.kind === "community") {
    return stableUnique(index.nodes.filter((node) => node.community === input.id).map((node) => node.id), index);
  }
  if (input.kind === "neighbors") {
    if (!index.nodeById.has(input.id)) return [];
    return stableUnique([input.id, ...Array.from(index.neighborsById.get(input.id) ?? [])], index);
  }
  return stableUnique(input.ids.filter((id) => index.nodeById.has(id)), index);
}

function selectionFacts(index: SelectionGraphIndex, nodeIds: NodeId[]): SelectionFacts {
  const selected = new Set(nodeIds);
  const internalLinkCount = index.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)).length;
  const isolatedCount = nodeIds.filter((id) => (index.neighborsById.get(id)?.size ?? 0) === 0).length;
  return {
    pageCount: nodeIds.length,
    internalLinkCount,
    communityCount: selectedCommunityIds(index, nodeIds).length,
    isolatedCount
  };
}

function selectedCommunityIds(index: SelectionGraphIndex, nodeIds: NodeId[]): CommunityId[] {
  const seen = new Set<CommunityId>();
  const communities: CommunityId[] = [];
  for (const id of nodeIds) {
    const community = index.nodeById.get(id)?.community;
    if (!community || seen.has(community)) continue;
    seen.add(community);
    communities.push(community);
  }
  return communities;
}

function stableUnique(ids: NodeId[], index: SelectionGraphIndex): NodeId[] {
  const selected = new Set(ids);
  return index.nodes.map((node) => node.id).filter((id) => selected.has(id));
}

function selectionId(input: SelectionInput, nodeIds: NodeId[]): string {
  return `${input.kind}:${nodeIds.join(",")}`;
}

function toSelectionNode(node: GraphNode): SelectionNode {
  return {
    id: node.id,
    label: node.label || node.id,
    community: String(node.community || "_none"),
    sourcePath: String(node.source_path || node.path || node.source || wikiPathForNode(node))
  };
}

function endpointId(value: unknown): NodeId | null {
  if (value == null || value === "") return null;
  return String(value);
}

function wikiPathForNode(node: GraphNode): string {
  const id = node.id.endsWith(".md") ? node.id.slice(0, -3) : node.id;
  const type = String(node.type || "");
  if (type === "topic") return `wiki/topics/${id}.md`;
  if (type === "source") return `wiki/sources/${id}.md`;
  if (type === "comparison") return `wiki/comparisons/${id}.md`;
  if (type === "synthesis") return `wiki/synthesis/${id}.md`;
  if (type === "query") return `wiki/queries/${id}.md`;
  return `wiki/entities/${id}.md`;
}
