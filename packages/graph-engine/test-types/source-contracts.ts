import {
  atlasNodePoint,
  buildGraphRendererAdapterData,
  buildRenderableGraph,
  buildAtlasModel,
  buildRegularSearchIndex,
  createGraphOfflineCapabilities,
  deriveAtlasLayout,
  normalizeGraphPinMap,
  projectGraphInput,
  resolveAtlasSearchMatches,
  resolveAtlasSelectedNodeId,
  resolveAtlasSemanticVisibility,
  resolveAtlasVisibleSnapshot,
  resolvePositionAndRangePolicy,
  resolveRenderPolicy,
  resolveRenderPolicyVisibility,
  resolveRegularSearchMatches,
  type GraphData,
  type GraphEngine,
  type GraphInputProjection,
  type AtlasCommunity,
  type AtlasEdge,
  type AtlasInsights,
  type AtlasLayout,
  type AtlasModel,
  type AtlasNode,
  type AtlasSemanticVisibility,
  type AtlasVisibleSnapshot,
  type GraphRendererAdapterData,
  type PositionAndRangePolicy,
  type RenderPolicyInput,
  type GraphVisibilityState,
  type PinMap,
  type RenderableGraph,
  type RenderPositionMap
} from "../src/index.js";
import type { GraphFacadeState } from "../src/facade.js";

const graph: GraphData = {
  meta: {
    build_date: "2026-07-17T00:00:00.000Z",
    wiki_title: "type contract",
    total_nodes: 2,
    total_edges: 1
  },
  nodes: [
    { id: "a", label: "A", type: "topic", community: "c1" },
    { id: "b", label: "B", type: "entity", community: "c1" }
  ],
  edges: [
    { id: "a-b", from: "a", to: "b", type: "EXTRACTED" }
  ]
};
const unknownGraph: unknown = graph;
const inputProjection: GraphInputProjection = projectGraphInput(unknownGraph);
const typedModel: AtlasModel = buildAtlasModel(inputProjection.data);
const typedLayout: AtlasLayout = deriveAtlasLayout(typedModel);
const typedNode: AtlasNode | undefined = typedModel.byId.a;
const typedEdge: AtlasEdge | undefined = typedModel.edges[0];
const typedCommunity: AtlasCommunity | undefined = typedModel.communityById.c1;
const typedInsights: AtlasInsights = typedModel.insights;
const typedVisible: AtlasVisibleSnapshot = resolveAtlasVisibleSnapshot(
  typedModel,
  typedLayout,
  { activeCommunityId: "all" }
);
const semanticVisibility: AtlasSemanticVisibility = resolveAtlasSemanticVisibility(typedModel, {
  activeCommunityId: "c1",
  typeFilters: { topic: true, entity: false }
});
const retainedSelection = resolveAtlasSelectedNodeId(typedModel, semanticVisibility, "a");
const atlasSearch = resolveAtlasSearchMatches(typedModel.searchIndex, "A");
const regularSearch = resolveRegularSearchMatches(buildRegularSearchIndex(inputProjection.data.nodes), "A");
// @ts-expect-error route state cannot omit the search compatibility half of the input projection
const incompleteFacadeState: GraphFacadeState = { data: graph, pins: {} };
void incompleteFacadeState;

const positions: RenderPositionMap = {
  a: { x: 10, y: 20 },
  b: { x: 30, y: 40 }
};
const pins: PinMap = normalizeGraphPinMap({
  "wiki/a.md": { x: 10, y: 20, coordinateSpace: "world" }
});
const positionPolicy: PositionAndRangePolicy = resolvePositionAndRangePolicy({
  nodes: typedModel.nodes,
  initialPositions: typedLayout.nodePositions,
  initialPositionsByIndex: new Map(typedLayout.nodes.flatMap((node) => (
    node ? [[node.idx, atlasNodePoint(node)] as const] : []
  ))),
  pins,
  positions,
  viewportSize: { width: 1600, height: 900 },
  frameToViewport: true
});
const renderPolicyInput: RenderPolicyInput = {
  data: graph,
  model: typedModel,
  layout: typedLayout,
  visibility: resolveRenderPolicyVisibility(typedModel, typedLayout)
};
const sharedPolicyRenderable: RenderableGraph = resolveRenderPolicy(renderPolicyInput);
const renderable: RenderableGraph = buildRenderableGraph(graph, { positions, pins });
const adapter: GraphRendererAdapterData = buildGraphRendererAdapterData(graph, {
  positions,
  pins,
  selection: { kind: "node", id: "a" }
});
const offline = createGraphOfflineCapabilities({
  persistPins(nextPins: PinMap): Promise<void> {
    void nextPins;
    return Promise.resolve();
  }
});

export function consumeSourceContracts(engine: GraphEngine, visibility: GraphVisibilityState): number {
  engine.setData(unknownGraph, pins);
  engine.setPins(pins);
  void visibility.searchResultIds;
  void offline.capabilities?.persistPins;
  return renderable.nodes.length
    + sharedPolicyRenderable.nodes.length
    + adapter.nodes.length
    + inputProjection.data.nodes.length
    + typedModel.nodes.length
    + typedInsights.bridge_nodes.length
    + positionPolicy.framingBounds.width
    + semanticVisibility.nodes.length
    + atlasSearch.matchIds.length
    + regularSearch.matchIds.length
    + Number(Boolean(typedNode && typedEdge && typedCommunity && typedVisible.nodes.length && retainedSelection));
}
