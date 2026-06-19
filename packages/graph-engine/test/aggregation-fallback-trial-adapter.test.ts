import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCommunityAggregationMarkers } from "../src";
import type { GraphData, PinMap } from "../src/types";
import { buildAggregationFallbackTrialModel } from "./aggregation-fallback-trial-adapter";

describe("aggregation fallback trial adapter", () => {
  it("preserves container semantics and internal selected/search/Pin markers", () => {
    const data = graphFixture();
    const pins: PinMap = {
      "wiki/a.md": { x: 10, y: 20, coordinateSpace: "world" }
    };
    const aggregationMarkers = buildCommunityAggregationMarkers(data, {
      pins,
      searchResultIds: ["b"],
      selectedNodeIds: ["a"],
      minCommunitySize: 3
    });

    const model = buildAggregationFallbackTrialModel(data, {
      pins,
      searchResultIds: ["b"],
      selection: { kind: "node", id: "a" },
      aggregationMarkers
    });

    assert.equal(model.behavior.route, "aggregation-fallback");
    assert.ok(model.containers.length >= 1);
    assert.deepEqual(model.containers[0]?.selectedNodeIds, ["a"]);
    assert.deepEqual(model.containers[0]?.searchResultIds, ["b"]);
    assert.deepEqual(model.containers[0]?.pinnedNodeIds, ["a"]);
    assert.ok(model.budget.visibleCards <= 0);
    assert.ok(model.budget.visibleNodes <= 10000);
    assert.ok(model.behavior.containerSelect.some((item) => item.containerId === "alpha" || item.containerId === model.containers[0]?.id));
    assert.deepEqual(model.behavior.pinInsideAggregation[0]?.pinnedNodeIds, ["a"]);
    assert.deepEqual(model.behavior.selectedObjectInsideAggregation[0]?.selectedNodeIds, ["a"]);
  });
});

function graphFixture(): GraphData {
  return {
    meta: {
      build_date: "2026-06-19T00:00:00.000Z",
      wiki_title: "aggregation fallback trial adapter",
      total_nodes: 5,
      total_edges: 4
    },
    nodes: [
      { id: "a", label: "Alpha", type: "topic", community: "alpha", source_path: "wiki/a.md", x: 0, y: 0 },
      { id: "b", label: "Beta needle", type: "entity", community: "alpha", source_path: "wiki/b.md", x: 10, y: 0 },
      { id: "c", label: "Gamma", type: "source", community: "alpha", source_path: "wiki/c.md", x: 20, y: 0 },
      { id: "d", label: "Delta", type: "entity", community: "alpha", source_path: "wiki/d.md", x: 30, y: 0 },
      { id: "e", label: "Epsilon", type: "source", community: "beta", source_path: "wiki/e.md", x: 40, y: 0 }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED", weight: 1 },
      { id: "b-c", from: "b", to: "c", type: "INFERRED", weight: 0.7 },
      { id: "c-d", from: "c", to: "d", type: "INFERRED", weight: 0.7 },
      { id: "d-e", from: "d", to: "e", type: "INFERRED", weight: 0.7 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "a", recommended_start_reason: "fixture", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: false },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: false },
        global: { enabled: true, node_ids: ["a", "b", "c", "d", "e"], degraded: false }
      },
      communities: [
        { id: "alpha", label: "Alpha", node_count: 4 },
        { id: "beta", label: "Beta", node_count: 1 }
      ]
    }
  };
}
