import {
  buildGraphRendererAdapterData,
  buildRenderableGraph,
  buildAtlasModel,
  deriveAtlasLayout,
  resolvePositionAndRangePolicy,
  resolveAtlasSemanticVisibility,
  resolveAtlasVisibleSnapshot,
  type AtlasInsights,
  type GraphData,
  type GraphEngine,
  type PinMap,
  type RenderPositionMap
} from "../src/index.js";
// @ts-expect-error legacy learning normalization is model-internal compatibility, not a public toolbox.
import { normalizeLearning } from "../src/index.js";

const graph: GraphData = {
  meta: { build_date: "", wiki_title: "negative", total_nodes: 1, total_edges: 0 },
  nodes: [{ id: "a", label: "A", type: "entity" }],
  edges: []
};

// @ts-expect-error Node facts require a stable string ID.
const invalidGraph: GraphData = { ...graph, nodes: [{ id: 1, label: "A", type: "entity" }] };

// @ts-expect-error Pin coordinate space is a closed compatibility contract.
const invalidPins: PinMap = { "wiki/a.md": { x: 1, y: 2, coordinateSpace: "screen" } };

// @ts-expect-error World positions require finite-number-shaped coordinates at compile time.
const invalidPositions: RenderPositionMap = { a: { x: "1", y: 2 } };

const typedModel = buildAtlasModel(graph);
const typedLayout = deriveAtlasLayout(typedModel);
const typedVisible = resolveAtlasVisibleSnapshot(typedModel, typedLayout);
// @ts-expect-error lookup tables require an absence check for unknown IDs.
typedModel.byId.missing.label;
// @ts-expect-error community lookups require an absence check for unknown IDs.
typedModel.communityById.missing.label;
// @ts-expect-error layout lookups require an absence check for unknown IDs.
typedLayout.nodePositions.missing.x;
// @ts-expect-error visible label lookups require an absence check for unknown IDs.
typedVisible.labelNodeIds.missing.valueOf();
// @ts-expect-error visible match lookups require an absence check for unknown IDs.
typedVisible.matchedNodeIds.missing.valueOf();
// @ts-expect-error visible importance lookups require an absence check for unknown IDs.
typedVisible.importantNodeIds.missing.valueOf();
// @ts-expect-error visible start lookups require an absence check for unknown IDs.
typedVisible.startNodeIds.missing.valueOf();
// @ts-expect-error normalized insight metadata always includes all count fields.
const incompleteAtlasInsights: AtlasInsights = { surprising_connections: [], isolated_nodes: [], bridge_nodes: [], sparse_communities: [], meta: { degraded: false } };
// @ts-expect-error normalized nodes cannot be replaced with raw graph nodes.
typedModel.nodes.push(graph.nodes[0]);
// @ts-expect-error visible model filters are booleans, not arbitrary strings.
resolveAtlasVisibleSnapshot(typedModel, typedLayout, { filters: { EXTRACTED: "yes" } });
// @ts-expect-error semantic type filters are booleans, not arbitrary strings.
resolveAtlasSemanticVisibility(typedModel, { typeFilters: { entity: "yes" } });

// @ts-expect-error The range policy requires immutable positions keyed by normalized node index.
resolvePositionAndRangePolicy({ nodes: typedModel.nodes, initialPositions: typedLayout.nodePositions });

// @ts-expect-error The range policy consumes normalized model nodes, not raw graph facts.
resolvePositionAndRangePolicy({ nodes: graph.nodes, initialPositions: typedLayout.nodePositions, initialPositionsByIndex: new Map() });

// @ts-expect-error Initial positions are world points, not normalized model nodes.
resolvePositionAndRangePolicy({ nodes: typedModel.nodes, initialPositions: { a: typedModel.nodes[0] }, initialPositionsByIndex: new Map() });

// @ts-expect-error Render options do not accept raw nodes in the positions stage.
buildRenderableGraph(graph, { positions: { a: graph.nodes[0] } });

// @ts-expect-error Adapter selection must use a supported discriminated selection input.
buildGraphRendererAdapterData(graph, { selection: { kind: "node", ids: ["a"] } });

declare const engine: GraphEngine;
// @ts-expect-error Engine themes are limited to the supported theme IDs.
engine.setTheme("purple");

void invalidGraph;
void invalidPins;
void invalidPositions;
void incompleteAtlasInsights;
void normalizeLearning;
