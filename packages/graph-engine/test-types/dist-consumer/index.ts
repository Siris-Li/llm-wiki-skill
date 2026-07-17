import {
  buildGraphRendererAdapterData,
  buildRenderableGraph,
  createGraphEngine,
  createGraphOfflineCapabilities,
  createGraphStandaloneCapabilities,
  createGraphWorkbenchCapabilities,
  createGraphRenderer,
  createStaticGraphRenderer,
  diffGraphData,
  normalizeGraphLayoutFile,
  normalizeGraphPinMap,
  type GraphData,
  type GraphEngine,
  type GraphRendererAdapterData,
  type GraphVisibilityState,
  type PinMap,
  type RenderableGraph
} from "../../dist/index.js";

const graph: GraphData = {
  meta: { build_date: "", wiki_title: "dist consumer", total_nodes: 1, total_edges: 0 },
  nodes: [{ id: "a", label: "A", type: "entity", source_path: "wiki/a.md" }],
  edges: []
};
const pins: PinMap = normalizeGraphPinMap({ "wiki/a.md": { x: 1, y: 2 } });
const renderable: RenderableGraph = buildRenderableGraph(graph, { pins });
const adapter: GraphRendererAdapterData = buildGraphRendererAdapterData(graph, { pins });
const layout = normalizeGraphLayoutFile({ version: 2, pins });
const diff = diffGraphData(graph, graph);

declare const container: HTMLElement;
declare const capabilities: Parameters<typeof createGraphWorkbenchCapabilities>[0];
const engine: GraphEngine = createGraphEngine(container, { data: graph, pins, theme: "shan-shui" });
const renderer = createGraphRenderer(container, { data: graph, theme: "shan-shui" });
const staticRenderer = createStaticGraphRenderer(container, { data: graph, theme: "shan-shui" });
const workbench = createGraphWorkbenchCapabilities(capabilities);
const offline = createGraphOfflineCapabilities();
const standalone = createGraphStandaloneCapabilities();
declare const visibility: GraphVisibilityState;

void [renderable, adapter, layout, diff, engine, renderer, staticRenderer, workbench, offline, standalone, visibility];
