import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCommunityLegend, buildRenderableGraph } from "../src/render";
import { UNGROUPED_COMMUNITY_ID, UNGROUPED_COMMUNITY_LABEL } from "../src/types";
import type { GraphData } from "../src/types";

describe("community legend", () => {
  it("lists the ungrouped virtual community as 未分组 with its node ids", () => {
    const graph = buildRenderableGraph(graphFixtureWithUngroupedNodes());
    const rows = buildCommunityLegend(
      graph.communities,
      graph.nodes.map((node) => ({ id: node.id, community: node.community }))
    );

    assert.equal(rows.find((row) => row.id === UNGROUPED_COMMUNITY_ID)?.label, UNGROUPED_COMMUNITY_LABEL);
    assert.deepEqual(
      rows.find((row) => row.id === UNGROUPED_COMMUNITY_ID)?.nodeIds,
      ["loose-a", "loose-b"]
    );
  });
});

function graphFixtureWithUngroupedNodes(): GraphData {
  return {
    meta: {
      build_date: "2026-06-18T00:00:00.000Z",
      wiki_title: "Legend ungrouped graph",
      total_nodes: 4,
      total_edges: 1
    },
    nodes: [
      { id: "a", label: "Alpha", type: "topic", community: "alpha", source_path: "wiki/alpha/a.md", weight: 2 },
      { id: "b", label: "Beta", type: "entity", community: "alpha", source_path: "wiki/alpha/b.md" },
      { id: "loose-a", label: "Loose A", type: "topic", community: null, source_path: "wiki/loose/a.md", score: 2 },
      { id: "loose-b", label: "Loose B", type: "entity", source_path: "wiki/loose/b.md", weight: 1 }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED", relation_type: "实现", weight: 0.6 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "a", recommended_start_reason: "hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: ["a", "b"], degraded: false }
      },
      communities: [
        { id: "alpha", label: "Alpha", node_count: 2, color_index: 0, members: ["a", "b"] }
      ]
    }
  };
}
