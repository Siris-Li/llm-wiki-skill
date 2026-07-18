import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveVisibleSnapshot,
  buildAtlasModel,
  deriveAtlasLayout,
  resolveAtlasSelectedNodeId,
  getAtlasDensityMode,
  atlasNodePoint
} from "../src/model";
import { resolveAtlasRenderVisibility } from "../src/render/render-policy";

describe("resolveVisibleSnapshot", () => {
  const nodes = [
    { id: "n1", label: "机器学习基础", content: "监督学习与数据预处理", degree: 2 },
    { id: "n2", label: "深度学习", content: "神经网络与 Transformer", degree: 3 },
    { id: "n3", label: "Transformer", content: "语言模型核心架构", degree: 2 },
    { id: "n4", label: "数据清洗", content: "数据预处理的一部分", degree: 1 }
  ];

  const links = [
    { id: "e1", source: "n1", target: "n2", type: "EXTRACTED", weight: 0.95 },
    { id: "e2", source: "n2", target: "n3", type: "EXTRACTED", weight: 0.91 },
    { id: "e3", source: "n1", target: "n4", type: "INFERRED", weight: 0.55 }
  ];

  it("combines edge filtering, focus mode, and search query", () => {
    const snapshot = resolveVisibleSnapshot({
      nodes,
      links,
      baseNodeIds: ["n1", "n2", "n3", "n4"],
      filters: { EXTRACTED: true, INFERRED: false, AMBIGUOUS: false },
      focusMode: "high_confidence",
      searchQuery: "transformer",
      anchorNodeId: "n2",
      highConfidenceThreshold: 0.9
    });

    assert.deepEqual(snapshot.node_ids, ["n2", "n3"]);
    assert.deepEqual(snapshot.nodes.map((node) => node.id), ["n2", "n3"]);
    assert.deepEqual(snapshot.links.map((link) => link.id), ["e2"]);
    assert.deepEqual(snapshot.searchIndex.map((entry) => entry.node.id), ["n1", "n2", "n3"]);
  });

  it("keeps one-hop scope around the selected anchor", () => {
    const snapshot = resolveVisibleSnapshot({
      nodes,
      links,
      baseNodeIds: ["n1", "n2", "n3"],
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: false },
      focusMode: "one_hop",
      searchQuery: "",
      anchorNodeId: "n2"
    });

    assert.deepEqual(snapshot.node_ids, ["n1", "n2", "n3"]);
    assert.deepEqual(snapshot.links.map((link) => link.id), ["e1", "e2"]);
  });

  it("returns empty visible nodes when search has no matches", () => {
    const snapshot = resolveVisibleSnapshot({
      nodes,
      links,
      baseNodeIds: ["n1", "n2", "n3"],
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: false },
      focusMode: "all",
      searchQuery: "不存在",
      anchorNodeId: "n2"
    });

    assert.deepEqual(snapshot.node_ids, []);
    assert.deepEqual(snapshot.nodes, []);
    assert.deepEqual(snapshot.links, []);
    assert.equal(snapshot.searchIndex.length, 3);
  });

  it("keeps an explicitly empty current range empty", () => {
    const snapshot = resolveVisibleSnapshot({
      nodes,
      links,
      baseNodeIds: [],
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: false },
      focusMode: "all",
      searchQuery: "机器"
    });

    assert.deepEqual(snapshot.node_ids, []);
    assert.deepEqual(snapshot.nodes, []);
    assert.deepEqual(snapshot.links, []);
    assert.deepEqual(snapshot.searchIndex, []);
  });
});

describe("atlas state contract", () => {
  const rawGraph = {
    meta: { wiki_title: "测试知识库", build_date: "2026-04-27" },
    nodes: [
      { id: "a", label: "知识编译", type: "topic", community: "method", confidence: "EXTRACTED", content: "# 知识编译\n\n整理一次，持续维护。" },
      { id: "b", label: "素材消化", type: "topic", community: "method", confidence: "INFERRED", source_path: "wiki/topics/b.md" },
      { id: "c", label: "网页文章", type: "source", community: "source", confidence: "AMBIGUOUS" }
    ],
    edges: [
      { id: "ab", from: "a", to: "b", type: "EXTRACTED", weight: 0.9 },
      { id: "ac", from: "a", to: "c", type: "INFERRED", weight: 0.6 }
    ],
    learning: {
      entry: { recommended_start_node_id: "a" },
      communities: [
        { id: "method", label: "方法论", node_count: 2, is_primary: true, recommended_start_node_id: "a" },
        { id: "source", label: "素材来源", node_count: 1, recommended_start_node_id: "c" }
      ]
    }
  };

  it("normalizes raw graph into one atlas model", () => {
    const model = buildAtlasModel(rawGraph);

    assert.equal(model.meta.wiki_title, "测试知识库");
    assert.equal(model.nodes.length, 3);
    assert.equal(model.edges.length, 2);
    assert.equal(model.byId.a.degree, 2);
    assert.equal(model.byId.a.summary, "整理一次，持续维护。");
    assert.deepEqual(model.communities.map((community) => community.label), ["方法论", "素材来源"]);
    assert.equal(model.starts[0].node.id, "a");
  });

  it("treats null atlas coordinates as missing layout input", () => {
    const model = buildAtlasModel({
      nodes: [
        { id: "nullish", label: "Nullish", x: null, y: null },
        { id: "origin", label: "Origin", x: 0, y: 0 }
      ],
      edges: []
    });
    const layout = deriveAtlasLayout(model);

    assert.notDeepEqual(
      pickPoint(layout.nodes.find((node) => node.id === "nullish")),
      { x: 5, y: 8 }
    );
    assert.deepEqual(
      pickPoint(layout.nodes.find((node) => node.id === "origin")),
      { x: 5, y: 8 }
    );
    assert.deepEqual(pickPoint(model.byId.origin), { x: 0, y: 0 });
    assert.deepEqual(pickPoint(model.byId.nullish), { x: null, y: null });
  });

  it("preserves relative shape when explicit community coordinates are outside the legacy percent range", () => {
    const model = buildAtlasModel({
      nodes: [
        { id: "a", label: "A", community: "edge-dense", x: 132, y: 126 },
        { id: "b", label: "B", community: "edge-dense", x: 148, y: 142 },
        { id: "c", label: "C", community: "edge-dense", x: 164, y: 158 }
      ],
      edges: []
    });
    const layout = deriveAtlasLayout(model);

    const points = ["a", "b", "c"].map((id) => pickPoint(layout.nodes.find((node) => node.id === id)));
    assert.ok(new Set(points.map((point) => point.x)).size > 1, "x positions should not collapse to one clamp boundary");
    assert.ok(new Set(points.map((point) => point.y)).size > 1, "y positions should not collapse to one clamp boundary");
    assert.ok(points.every((point) => point.x >= 5 && point.x <= 95));
    assert.ok(points.every((point) => point.y >= 8 && point.y <= 92));
  });

  it("uses one visible snapshot for filters, search, density, and starts", () => {
    const model = buildAtlasModel(rawGraph);
    const layout = deriveAtlasLayout(model);
    const snapshot = resolveAtlasRenderVisibility(model, {
      activeCommunityId: "method",
      focusMode: "all",
      query: "素材",
      selectedNodeId: "a",
      filters: { EXTRACTED: true, INFERRED: true }
    });

    assert.deepEqual(snapshot.node_ids, ["b"]);
    assert.deepEqual(snapshot.nodes.map((node) => node.id), ["b"]);
    assert.deepEqual(snapshot.edges, []);
    assert.equal(snapshot.densityMode, "card");
    assert.equal(snapshot.starts[0].node.id, "b");
    assert.equal(snapshot.importantNodeIds.b, true);
    assert.equal(snapshot.counts.total_nodes, 3);
  });

  it("keeps recommended starts and high-priority nodes readable as atlas index slips", () => {
    const model = buildAtlasModel(rawGraph);
    const layout = deriveAtlasLayout(model);
    const snapshot = resolveAtlasRenderVisibility(model, {
      activeCommunityId: "all",
      focusMode: "all",
      query: "",
      selectedNodeId: null,
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true, UNVERIFIED: true }
    });

    assert.equal(snapshot.starts[0].node.id, "a");
    assert.equal(snapshot.startNodeIds.a, true);
    assert.equal(snapshot.importantNodeIds.a, true);
    assert.equal(snapshot.labelNodeIds.a, true);
  });

  it("preserves only explicit selections inside the current visible atlas range", () => {
    const model = buildAtlasModel(rawGraph);
    const layout = deriveAtlasLayout(model);
    const methodSnapshot = resolveAtlasRenderVisibility(model, {
      activeCommunityId: "source",
      focusMode: "all",
      query: "",
      selectedNodeId: "a",
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true, UNVERIFIED: true }
    });
    const emptySnapshot = resolveAtlasRenderVisibility(model, {
      activeCommunityId: "source",
      focusMode: "all",
      query: "没有结果",
      selectedNodeId: "c",
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true, UNVERIFIED: true }
    });

    assert.equal(resolveAtlasSelectedNodeId(model, methodSnapshot, "a"), null);
    assert.equal(resolveAtlasSelectedNodeId(model, methodSnapshot, "c"), "c");
    assert.equal(resolveAtlasSelectedNodeId(model, emptySnapshot, "c"), null);
  });

  it("does not auto-select a recommended start on first open", () => {
    const model = buildAtlasModel(rawGraph);
    const layout = deriveAtlasLayout(model);
    const snapshot = resolveAtlasRenderVisibility(model, {
      activeCommunityId: "all",
      focusMode: "all",
      query: "",
      selectedNodeId: null,
      filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true, UNVERIFIED: true }
    });

    assert.equal(snapshot.starts[0].node.id, "a");
    assert.equal(resolveAtlasSelectedNodeId(model, snapshot, null), null);
  });

  it("selects density mode by visible node budget", () => {
    assert.equal(getAtlasDensityMode(50), "card");
    assert.equal(getAtlasDensityMode(120), "compact-card");
    assert.equal(getAtlasDensityMode(300), "point-plus-focus");
    assert.equal(getAtlasDensityMode(800), "overview");
  });

  it("keeps the current world coordinate conversion for positioned nodes", () => {
    const model = buildAtlasModel(rawGraph);
    const layout = deriveAtlasLayout(model);
    const positioned = layout.nodes.find((node) => node.id === "a");
    assert.ok(positioned);

    const point = atlasNodePoint(positioned);
    assert.equal(point.x, positioned.x * 10);
    assert.equal(point.y, positioned.y * 6.8);
  });
});

function pickPoint(node: { x: number | null; y: number | null } | undefined): { x: number | null; y: number | null } {
  assert.ok(node);
  return { x: node.x, y: node.y };
}
