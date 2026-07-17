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
  projectGraphInput,
  type GraphData
} from "../../src";
import type { AtlasLayout, AtlasModel, AtlasNode, AtlasVisibleSnapshot, RenderableGraph } from "../../src";
import type { GraphRendererAdapterData } from "../../src/render";

export function captureSupportedMigrationBehavior(input: GraphData): unknown {
  const projection = projectGraphInput(input);
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
      label: resolveGraphSearchState(projection.data.nodes, "alpha", undefined, projection.regularSearchByNode).matchIds,
      idFallback: resolveGraphSearchState(projection.data.nodes, "numeric-label", undefined, projection.regularSearchByNode).matchIds,
      whitespaceLabel: resolveGraphSearchState(projection.data.nodes, "duplicate", undefined, projection.regularSearchByNode).matchIds,
      at500: resolveGraphSearchState(projection.data.nodes, "z", undefined, projection.regularSearchByNode).matchIds,
      after500: resolveGraphSearchState(projection.data.nodes, "only-atlas-501", undefined, projection.regularSearchByNode).matchIds
    },
    model: modelBeforeLayout,
    layout: legacyLayoutProjection(layout),
    visible: legacyVisibleProjection(visible, layout),
    atlasSearch: legacyVisibleProjection(atlasSearch, layout),
    renderable: legacyRenderableProjection(renderable),
    adapter: legacyAdapterProjection(adapter)
  });
}

// The immutable layout contract intentionally separates positions from model facts.
// Compare the new staged result in the legacy baseline's representation so the
// checked-in fixture remains fixed while every user-visible value stays exact.
function legacyLayoutProjection(layout: AtlasLayout): Omit<AtlasLayout, "layoutBounds" | "nodePositions"> & {
  nodePositions: Record<string, { x: number | null; y: number | null }>;
} {
  return {
    nodes: layout.nodes,
    edges: layout.edges,
    nodePositions: Object.fromEntries(layout.nodes.map((node) => [node.id, { x: node.x, y: node.y }]))
  };
}

function legacyVisibleProjection(snapshot: AtlasVisibleSnapshot, layout: AtlasLayout): AtlasVisibleSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => positionedNode(node, layout)),
    searchIndex: snapshot.searchIndex.map((entry) => ({
      ...entry,
      node: positionedNode(entry.node, layout)
    })),
    starts: snapshot.starts.map((entry) => ({
      ...entry,
      node: positionedNode(entry.node, layout)
    }))
  };
}

function legacyRenderableProjection(renderable: RenderableGraph): Omit<RenderableGraph, "contentBounds" | "framingBounds"> {
  const { contentBounds: _contentBounds, framingBounds: _framingBounds, ...legacy } = renderable;
  return {
    ...legacy,
    model: positionedModel(renderable.model, renderable.layout),
    layout: legacyLayoutProjection(renderable.layout) as AtlasLayout
  };
}

function legacyAdapterProjection(adapter: GraphRendererAdapterData): GraphRendererAdapterData {
  return {
    ...adapter,
    renderable: legacyRenderableProjection(adapter.renderable) as RenderableGraph
  };
}

function positionedModel(model: AtlasModel, layout: AtlasLayout): AtlasModel {
  return {
    ...model,
    nodes: model.nodes.map((node) => positionedNode(node, layout)),
    byId: Object.fromEntries(Object.entries(model.byId).map(([id, node]) => [id, positionedNode(node, layout)])),
    starts: model.starts.map((entry) => ({ ...entry, node: positionedNode(entry.node, layout) })),
    searchIndex: model.searchIndex.map((entry) => ({ ...entry, node: positionedNode(entry.node, layout) }))
  };
}

function positionedNode(node: AtlasNode, layout: AtlasLayout): AtlasNode {
  const positioned = layout.nodes.find((candidate) => candidate.idx === node.idx);
  return positioned ? { ...node, x: positioned.x, y: positioned.y } : { ...node };
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
