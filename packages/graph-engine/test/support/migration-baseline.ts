import {
  atlasConfidenceLabel,
  atlasNodeKind,
  atlasTypeLabel,
  buildAtlasModel,
  buildGraphRendererAdapterData,
  buildRenderableGraph,
  cardDims,
  deriveAtlasLayout,
  measureLabelWidth,
  resolveAtlasVisibleSnapshot,
  resolveGraphSearchState,
  splitLabelGraphemes,
  stripAtlasMarkdown,
  truncateLabel,
  type GraphData
} from "../../src";

export function captureSupportedMigrationBehavior(input: GraphData): unknown {
  const model = buildAtlasModel(input);
  const modelBeforeLayout = stableClone(model);
  const layout = deriveAtlasLayout(model);
  const visible = resolveAtlasVisibleSnapshot(model, layout, {
    activeCommunityId: "all",
    selectedNodeId: "alpha",
    filters: { INFERRED: true, AMBIGUOUS: true, EXTRACTED: true, UNVERIFIED: false }
  });
  const atlasSearch = resolveAtlasVisibleSnapshot(model, layout, {
    activeCommunityId: "all",
    query: "only-atlas-501"
  });
  const renderOptions = {
    pins: {
      "wiki/duplicate-second.md": { x: 760, y: 510, coordinateSpace: "world" as const }
    },
    positions: {
      alpha: { x: 1220, y: -240 }
    },
    selection: { kind: "nodes" as const, ids: ["alpha", "duplicate"] },
    searchResultIds: ["long-content", "duplicate"],
    viewportSize: { width: 960, height: 540 }
  };
  const renderable = buildRenderableGraph(input, renderOptions);
  const adapterInput = supportedAdapterInput(input);
  const adapter = buildGraphRendererAdapterData(adapterInput, renderOptions);

  return stableClone({
    text: {
      graphemes: splitLabelGraphemes("A中👩‍💻 e\u0301"),
      width: measureLabelWidth(splitLabelGraphemes("A中👩‍💻")),
      truncation: truncateLabel("超长 Alpha 👩‍💻 标题", 88),
      cards: [
        cardDims({ id: "topic", label: "主题 Alpha", type: "topic" }),
        cardDims({ id: "source", label: "来源", type: "source" })
      ],
      markdown: stripAtlasMarkdown("---\ntitle: x\n---\n# Heading\n- **Bold** [[page|Label]] [link](url)"),
      labels: {
        confidence: atlasConfidenceLabel("unknown"),
        type: atlasTypeLabel("unknown"),
        kind: atlasNodeKind("source")
      }
    },
    regularSearch: {
      label: resolveGraphSearchState(input.nodes, "alpha").matchIds,
      idFallback: resolveGraphSearchState(input.nodes, "numeric-label").matchIds,
      whitespaceLabel: resolveGraphSearchState(input.nodes, "duplicate").matchIds,
      at500: resolveGraphSearchState(input.nodes, "z").matchIds,
      after500: resolveGraphSearchState(input.nodes, "only-atlas-501").matchIds
    },
    model: modelBeforeLayout,
    layout,
    visible,
    atlasSearch,
    renderable,
    adapter
  });
}

function supportedAdapterInput(input: GraphData): GraphData {
  const nodes = input.nodes.filter((node) => node && typeof node.id === "string");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.edges.filter((edge) => (
    edge
    && typeof edge.id === "string"
    && typeof edge.from === "string"
    && typeof edge.to === "string"
    && nodeIds.has(edge.from)
    && nodeIds.has(edge.to)
  ));
  return {
    ...input,
    meta: { ...input.meta, total_nodes: nodes.length, total_edges: edges.length },
    nodes,
    edges
  };
}

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
