import {
  buildGraphRendererAdapterData,
  buildRenderableGraph,
  type GraphData,
  type GraphEngine,
  type PinMap,
  type RenderPositionMap
} from "../src/index.js";

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
