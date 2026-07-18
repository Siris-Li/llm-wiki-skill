import { UNGROUPED_COMMUNITY_ID } from "../types";
import type {
  CommunityId,
  Confidence,
  EdgeId,
  GraphNodeType,
  GraphPinHint,
  GraphRelationType,
  GraphResolvedAggregation,
  GraphRendererSemantics,
  GraphSummaryCommand,
  GraphSummaryObjectRef,
  GraphSummarySelectionState,
  NodeId,
  WikiPath
} from "../types";
import type { CommunityMapEdgeLayer, CommunityMapLabelSide, CommunityMapNodeTier, RenderPosition, RenderableGraph } from "./render-policy";
import type { GraphRelationFocusDepth } from "./relation-focus";

export const GRAPH_RENDERER_ADAPTER_ROUTES = ["dom-svg", "candidate-global", "aggregation-fallback"] as const;

export type GraphRendererAdapterRoute = typeof GRAPH_RENDERER_ADAPTER_ROUTES[number];

export interface GraphRendererAdapterInput extends GraphRendererSemantics {
  renderable: RenderableGraph;
  sourceCommunityId: string | null;
}

export interface GraphRendererAdapterData {
  renderable: RenderableGraph;
  counts: RenderableGraph["counts"];
  selection: GraphSummarySelectionState;
  sourceCommunityId: string | null;
  nodes: GraphRendererAdapterNode[];
  edges: GraphRendererAdapterEdge[];
  communities: GraphRendererAdapterCommunity[];
  aggregations: GraphRendererAdapterAggregation[];
}

export interface GraphRendererDrawerTarget {
  summaryKind: "node-summary" | "community-summary" | "excluded-object";
  object: GraphSummaryObjectRef;
  reason?: "aggregation";
}

export interface GraphRendererAdapterNode {
  id: NodeId;
  object: { kind: "node"; nodeId: NodeId };
  label: string;
  type: GraphNodeType;
  communityId: CommunityId | null;
  sourcePath: WikiPath;
  point: RenderPosition;
  selected: boolean;
  searchHit: boolean;
  relationFocusDepth: GraphRelationFocusDepth;
  pinHint: GraphPinHint;
  aggregationIds: string[];
  drawerTarget: GraphRendererDrawerTarget;
  render: {
    displayMode: string;
    visualRole: string;
    priority: number;
    labelVisible: boolean;
    startNode?: boolean;
    previewStart?: boolean;
    communityMapTier: CommunityMapNodeTier;
    communityMapImportance: number;
    communityMapDotSize: number;
    communityMapLabelSide: CommunityMapLabelSide;
    communityMapRelationLabel: boolean;
  };
}

export interface GraphRendererAdapterEdge {
  id: EdgeId;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  sourceCommunityId: CommunityId | null;
  targetCommunityId: CommunityId | null;
  relationType: GraphRelationType | null;
  confidence: Confidence | null;
  weight: number;
  render: {
    strokeWidth: number;
    opacity: number;
    communityMapLayer: CommunityMapEdgeLayer;
    relationFocusDepth: GraphRelationFocusDepth;
    skeleton: boolean;
    traceable: boolean;
    selectedRelation: boolean;
  };
}

export interface GraphRendererAdapterCommunity {
  id: CommunityId;
  object: { kind: "community"; communityId: CommunityId };
  label: string;
  nodeIds: NodeId[];
  nodeCount: number;
  selected: boolean;
  searchResultIds: NodeId[];
  pinHints: GraphPinHint[];
  aggregationIds: string[];
  drawerTarget: GraphRendererDrawerTarget;
  commands: GraphSummaryCommand[];
}

export interface GraphRendererAdapterAggregation {
  id: string;
  object: { kind: "aggregation"; aggregationId: string; nodeIds: NodeId[]; communityId?: CommunityId | null };
  label: string;
  communityId: CommunityId | null;
  nodeIds: NodeId[];
  selectedNodeIds: NodeId[];
  searchResultIds: NodeId[];
  pinnedNodeIds: NodeId[];
  totalCount: number;
  selected: boolean;
  pinHints: GraphPinHint[];
  drawerTarget: GraphRendererDrawerTarget;
  commands: GraphSummaryCommand[];
}

export interface GraphRendererBehaviorContract {
  route: GraphRendererAdapterRoute;
  pointSelect: GraphRendererPointSelectBehavior[];
  containerSelect: GraphRendererContainerSelectBehavior[];
  searchHighlight: GraphRendererSearchHighlightBehavior[];
  selectedObjectInsideAggregation: GraphRendererSelectedAggregationBehavior[];
  pinInsideAggregation: GraphRendererPinnedAggregationBehavior[];
  enterCommunity: GraphRendererEnterCommunityBehavior[];
}

export interface GraphRendererPointSelectBehavior {
  nodeId: NodeId;
  object: { kind: "node"; nodeId: NodeId };
  drawerTarget: GraphRendererDrawerTarget;
  selected: boolean;
  searchHit: boolean;
  pinHint: GraphPinHint;
  aggregationIds: string[];
}

export interface GraphRendererContainerSelectBehavior {
  containerId: CommunityId | string;
  object: GraphSummaryObjectRef;
  drawerTarget: GraphRendererDrawerTarget;
  selected: boolean;
  searchResultIds: NodeId[];
  pinHintNodeIds: NodeId[];
}

export interface GraphRendererSearchHighlightBehavior {
  nodeId: NodeId;
  object: { kind: "node"; nodeId: NodeId };
  aggregationIds: string[];
  drawerTarget: GraphRendererDrawerTarget;
}

export interface GraphRendererSelectedAggregationBehavior {
  aggregationId: string;
  object: { kind: "aggregation"; aggregationId: string; nodeIds: NodeId[]; communityId?: CommunityId | null };
  selectedNodeIds: NodeId[];
  selected: boolean;
  drawerTarget: GraphRendererDrawerTarget;
}

export interface GraphRendererPinnedAggregationBehavior {
  aggregationId: string;
  pinnedNodeIds: NodeId[];
  pinHints: GraphPinHint[];
  drawerTarget: GraphRendererDrawerTarget;
}

export interface GraphRendererEnterCommunityBehavior {
  communityId: CommunityId;
  command: Extract<GraphSummaryCommand, { kind: "enter-community" }>;
}

export function buildGraphRendererAdapterData(
  input: GraphRendererAdapterInput
): GraphRendererAdapterData {
  const { renderable } = input;
  const renderNodeById = new Map(renderable.nodes.map((node) => [node.id, node]));
  const nodeSemanticsById = new Map(input.nodes.map((node) => [node.id, node]));
  const edgeSemanticsByObject = new Map(input.edges.map((edge) => [edgeSemanticKey(edge.id, edge.sourceNodeId, edge.targetNodeId), edge]));
  const pinHintByNodeId = new Map(input.pinHints.map((hint) => [hint.nodeId, hint]));
  const searchResultIds = input.searchResultIds;
  const searchSet = new Set(searchResultIds);
  const selection = input.selection;
  const selectedNodeSet = new Set(selection.selectedNodeIds);
  const selectedCommunitySet = new Set(selection.selectedCommunityIds);
  const aggregations = input.aggregations;

  const nodes = renderable.nodes.map((renderNode): GraphRendererAdapterNode => {
    const communityId = nodeSemanticsById.get(renderNode.id)?.communityId ?? renderNode.community ?? null;
    const pinHint = pinHintByNodeId.get(renderNode.id) ?? unpinnedHint(renderNode.id, renderNode.sourcePath);
    return {
      id: renderNode.id,
      object: { kind: "node", nodeId: renderNode.id },
      label: renderNode.label,
      type: renderNode.type,
      communityId,
      sourcePath: renderNode.sourcePath,
      point: renderNode.point,
      selected: selectedNodeSet.has(renderNode.id),
      searchHit: searchSet.has(renderNode.id),
      relationFocusDepth: renderNode.relationFocusDepth,
      pinHint,
      aggregationIds: aggregationsContainingNode(aggregations, renderNode.id).map((aggregation) => aggregation.id),
      drawerTarget: {
        summaryKind: "node-summary",
        object: { kind: "node", nodeId: renderNode.id }
      },
      render: {
        displayMode: renderNode.displayMode,
        visualRole: renderNode.visualRole,
        priority: renderNode.priority,
        labelVisible: renderNode.labelVisible,
        startNode: renderNode.startNode,
        previewStart: renderNode.previewStart,
        communityMapTier: renderNode.communityMapTier,
        communityMapImportance: renderNode.communityMapImportance,
        communityMapDotSize: renderNode.communityMapDotSize,
        communityMapLabelSide: renderNode.communityMapLabelSide,
        communityMapRelationLabel: renderNode.communityMapRelationLabel
      }
    };
  });

  const communities = renderable.communities.map((community): GraphRendererAdapterCommunity => {
    const nodeIds = renderable.nodes.filter((node) => node.community === community.id).map((node) => node.id);
    const communityAggregations = aggregationsContainingCommunity(aggregations, community.id);
    const pinHints = nodeIds.map((id) => pinHintByNodeId.get(id)).filter((hint): hint is GraphPinHint => Boolean(hint?.pinned));
    return {
      id: community.id,
      object: { kind: "community", communityId: community.id },
      label: community.label,
      nodeIds,
      nodeCount: community.nodeCount,
      selected: selectedCommunitySet.has(community.id),
      searchResultIds: stableIntersection(nodeIds, searchResultIds),
      pinHints,
      aggregationIds: communityAggregations.map((aggregation) => aggregation.id),
      drawerTarget: {
        summaryKind: "community-summary",
        object: { kind: "community", communityId: community.id }
      },
      commands: community.id === UNGROUPED_COMMUNITY_ID ? [] : [enterCommunityCommand(community.id)]
    };
  });

  const edges = renderable.edges.map((edge): GraphRendererAdapterEdge => {
    const semantics = edgeSemanticsByObject.get(edgeSemanticKey(edge.id, edge.source, edge.target));
    return {
      id: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      sourceCommunityId: semantics?.sourceCommunityId ?? null,
      targetCommunityId: semantics?.targetCommunityId ?? null,
      relationType: semantics?.relationType ?? edge.relationType ?? null,
      confidence: semantics?.confidence ?? edge.confidence ?? null,
      weight: semantics?.weight ?? 0,
      render: {
        strokeWidth: edge.strokeWidth,
        opacity: edge.opacity,
        communityMapLayer: edge.communityMapLayer,
        relationFocusDepth: edge.relationFocusDepth,
        skeleton: edge.skeleton,
        traceable: edge.traceable,
        selectedRelation: edge.selectedRelation
      }
    };
  });

  const adaptedAggregations = aggregations.map((aggregation): GraphRendererAdapterAggregation => {
    const object = { kind: "aggregation" as const, aggregationId: aggregation.id, nodeIds: [...aggregation.nodeIds], communityId: aggregation.communityId };
    const drawerTarget: GraphRendererDrawerTarget = aggregation.communityId
      ? {
          summaryKind: "community-summary",
          object: { kind: "community", communityId: aggregation.communityId }
        }
      : {
          summaryKind: "excluded-object",
          object,
          reason: "aggregation"
        };
    return {
      id: aggregation.id,
      object,
      label: aggregation.label,
      communityId: aggregation.communityId,
      nodeIds: [...aggregation.nodeIds],
      selectedNodeIds: [...aggregation.selectedNodeIds],
      searchResultIds: [...aggregation.searchResultIds],
      pinnedNodeIds: [...aggregation.pinnedNodeIds],
      totalCount: aggregation.totalCount,
      selected: aggregation.selectedNodeIds.length > 0 || Boolean(aggregation.communityId && selectedCommunitySet.has(aggregation.communityId)),
      pinHints: [...aggregation.pinHints],
      drawerTarget,
      commands: [
        { kind: "show-this-object", object, label: "显示这个对象" },
        { kind: "clear-temporary-object-display", label: "清除临时显示" }
      ]
    };
  });

  return {
    renderable,
    counts: renderable.counts,
    selection,
    sourceCommunityId: input.sourceCommunityId,
    nodes,
    edges: edges.filter((edge) => renderNodeById.has(edge.sourceNodeId) && renderNodeById.has(edge.targetNodeId)),
    communities,
    aggregations: adaptedAggregations
  };
}

export function buildGraphRendererBehaviorContract(
  adapter: GraphRendererAdapterData,
  route: GraphRendererAdapterRoute
): GraphRendererBehaviorContract {
  return {
    route,
    pointSelect: adapter.nodes.map((node) => ({
      nodeId: node.id,
      object: node.object,
      drawerTarget: node.drawerTarget,
      selected: node.selected,
      searchHit: node.searchHit,
      pinHint: node.pinHint,
      aggregationIds: node.aggregationIds
    })),
    containerSelect: [
      ...adapter.communities.map((community) => ({
        containerId: community.id,
        object: community.object,
        drawerTarget: community.drawerTarget,
        selected: community.selected,
        searchResultIds: community.searchResultIds,
        pinHintNodeIds: community.pinHints.map((hint) => hint.nodeId)
      })),
      ...adapter.aggregations.map((aggregation) => ({
        containerId: aggregation.id,
        object: aggregation.object,
        drawerTarget: aggregation.drawerTarget,
        selected: aggregation.selected,
        searchResultIds: aggregation.searchResultIds,
        pinHintNodeIds: aggregation.pinHints.map((hint) => hint.nodeId)
      }))
    ],
    searchHighlight: adapter.nodes
      .filter((node) => node.searchHit)
      .map((node) => ({
        nodeId: node.id,
        object: node.object,
        aggregationIds: node.aggregationIds,
        drawerTarget: node.drawerTarget
      })),
    selectedObjectInsideAggregation: adapter.aggregations
      .filter((aggregation) => aggregation.selectedNodeIds.length > 0)
      .map((aggregation) => ({
        aggregationId: aggregation.id,
        object: aggregation.object,
        selectedNodeIds: aggregation.selectedNodeIds,
        selected: aggregation.selected,
        drawerTarget: aggregation.drawerTarget
      })),
    pinInsideAggregation: adapter.aggregations
      .filter((aggregation) => aggregation.pinnedNodeIds.length > 0)
      .map((aggregation) => ({
        aggregationId: aggregation.id,
        pinnedNodeIds: aggregation.pinnedNodeIds,
        pinHints: aggregation.pinHints,
        drawerTarget: aggregation.drawerTarget
      })),
    enterCommunity: adapter.communities
      .filter((community) => community.id !== UNGROUPED_COMMUNITY_ID)
      .map((community) => ({
        communityId: community.id,
        command: enterCommunityCommand(community.id)
      }))
  };
}

function unpinnedHint(nodeId: NodeId, sourcePath: WikiPath): GraphPinHint {
  return {
    nodeId,
    wikiPath: sourcePath,
    pinned: false,
    position: null
  };
}

function aggregationsContainingNode(aggregations: GraphResolvedAggregation[], nodeId: NodeId): GraphResolvedAggregation[] {
  return aggregations.filter((aggregation) => aggregation.nodeIds.includes(nodeId));
}

function aggregationsContainingCommunity(aggregations: GraphResolvedAggregation[], communityId: CommunityId): GraphResolvedAggregation[] {
  return aggregations.filter((aggregation) => aggregation.communityId === communityId);
}

function edgeSemanticKey(id: EdgeId, sourceNodeId: NodeId, targetNodeId: NodeId): string {
  return `${id}\u0000${sourceNodeId}\u0000${targetNodeId}`;
}

function stableIntersection(sourceIds: NodeId[], candidateIds: NodeId[]): NodeId[] {
  const candidates = new Set(candidateIds);
  return sourceIds.filter((id) => candidates.has(id));
}

function enterCommunityCommand(communityId: CommunityId): Extract<GraphSummaryCommand, { kind: "enter-community" }> {
  return { kind: "enter-community", communityId, label: "进入社区" };
}
