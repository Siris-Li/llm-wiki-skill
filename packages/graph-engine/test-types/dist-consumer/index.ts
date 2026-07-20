import {
  buildGraphRendererAdapterData,
  alignGraphIdentityBySourcePath,
  buildRenderableGraph,
  buildAtlasModel,
  createGraphEngine,
  createGraphOfflineCapabilities,
  createGraphStandaloneCapabilities,
  createGraphWorkbenchCapabilities,
  createGraphRenderer,
  createStaticGraphRenderer,
  diffGraphData,
  deriveAtlasLayout,
  normalizeGraphLayoutFile,
  normalizeGraphInputCollections,
  normalizeGraphPinMap,
  projectGraphInput,
  resolveGraphRendererSemantics,
  type AtlasModel,
  type GraphData,
  type GraphEngine,
  type GraphInputProjection,
  type GraphMigrationWarning,
  type GraphWarningGroup,
  type GraphRendererAdapterData,
  type GraphVisibilityState,
  type PinMap,
  type RenderableGraph
} from "@llm-wiki/graph-engine";

const graph: GraphData = {
  meta: { build_date: "", wiki_title: "dist consumer", total_nodes: 1, total_edges: 0 },
  nodes: [{ id: "a", label: "A", type: "entity", source_path: "wiki/a.md" }],
  edges: []
};
const pins: PinMap = normalizeGraphPinMap({ "wiki/a.md": { x: 1, y: 2 } });
const renderable: RenderableGraph = buildRenderableGraph(graph, { pins });
const layoutBounds = renderable.layout.layoutBounds;
const contentBounds = renderable.contentBounds;
const framingBounds = renderable.framingBounds;
const adapter: GraphRendererAdapterData = buildGraphRendererAdapterData({
  renderable,
  ...resolveGraphRendererSemantics(graph, { pins }),
  sourceCommunityId: null
});
const layout = normalizeGraphLayoutFile({ version: 2, pins });
const diff = diffGraphData(graph, graph);
const alignment = alignGraphIdentityBySourcePath(graph, graph);
const unknownGraph: unknown = graph;
const warnings: GraphWarningGroup[] = [];
const normalized = normalizeGraphInputCollections(unknownGraph, warnings);
const inputProjection: GraphInputProjection = projectGraphInput(unknownGraph, warnings);
const model: AtlasModel = buildAtlasModel(inputProjection.data, warnings);
const migrationWarning: GraphMigrationWarning | undefined = diff.migrationWarnings[0];
const atlasLayout = deriveAtlasLayout(model);

declare const container: HTMLElement;
declare const capabilities: Parameters<typeof createGraphWorkbenchCapabilities>[0];
const engine: GraphEngine = createGraphEngine(container, { data: graph, pins, theme: "shan-shui" });
const renderer = createGraphRenderer(container, { data: graph, theme: "shan-shui" });
const staticRenderer = createStaticGraphRenderer(container, { data: graph, theme: "shan-shui" });
const workbench = createGraphWorkbenchCapabilities(capabilities);
const offline = createGraphOfflineCapabilities();
const standalone = createGraphStandaloneCapabilities();
declare const visibility: GraphVisibilityState;

engine.setData(unknownGraph);
void [renderable, layoutBounds, contentBounds, framingBounds, adapter, layout, diff, alignment, normalized, inputProjection, model, atlasLayout, migrationWarning, engine, renderer, staticRenderer, workbench, offline, standalone, visibility];
