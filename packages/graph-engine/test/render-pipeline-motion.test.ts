import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRenderableGraph, type RenderableGraph } from "../src/render";
import { shouldRunLiveSimulation } from "../src/render/render-pipeline";
import type { GraphData } from "../src";

describe("graph render pipeline motion policy", () => {
  it("keeps global mode live but freezes focused community reading mode", () => {
    const data = graphData();
    const globalGraph = buildRenderableGraph(data);
    const communityGraph = buildRenderableGraph(data, { focus: { kind: "community", id: "alpha" } });

    assert.equal(shouldRunLiveSimulation(globalGraph, true), true);
    assert.equal(shouldRunLiveSimulation(communityGraph, true), false);
    assert.equal(shouldRunLiveSimulation(globalGraph, false), false);
    assert.equal(shouldRunLiveSimulation(emptyGraph(globalGraph), true), false);
  });
});

function emptyGraph(graph: RenderableGraph): RenderableGraph {
  return { ...graph, nodes: [] };
}

function graphData(): GraphData {
  return {
    meta: {
      build_date: "2026-07-03T00:00:00.000Z",
      wiki_title: "Motion Policy Fixture",
      total_nodes: 3,
      total_edges: 2
    },
    nodes: [
      { id: "a", label: "A", type: "topic", community: "alpha", source_path: "wiki/a.md", x: 10, y: 20, weight: 90 },
      { id: "b", label: "B", type: "entity", community: "alpha", source_path: "wiki/b.md", x: 30, y: 40, weight: 60 },
      { id: "c", label: "C", type: "entity", community: "beta", source_path: "wiki/c.md", x: 70, y: 80, weight: 30 }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED", confidence: "EXTRACTED", relation_type: "实现", weight: 1 },
      { id: "b-c", from: "b", to: "c", type: "INFERRED", confidence: "INFERRED", relation_type: "依赖", weight: 0.4 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "a", recommended_start_reason: "fixture", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: true, community_id: "alpha", label: "Alpha", node_ids: ["a", "b"], is_weak: false, degraded: false },
        global: { enabled: true, node_ids: ["a", "b", "c"], degraded: false }
      },
      communities: [
        { id: "alpha", label: "Alpha", node_count: 2, color_index: 0, recommended_start_node_id: "a" },
        { id: "beta", label: "Beta", node_count: 1, color_index: 1 }
      ]
    }
  };
}
