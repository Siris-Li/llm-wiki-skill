import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  summarizeExcludedGraphObject,
  summarizeGraphCommunity,
  summarizeGraphGlobal,
  summarizeGraphNode,
  summarizeGraphSearchResults,
  summarizeUnavailableGraphObject
} from "../src/summary";
import type { GraphAggregationMarker, GraphData, GraphSummaryCommand, PinMap } from "../src/types";

describe("graph summary contract", () => {
  it("preserves node identity, selection, search hits, Pin hints, relations, and aggregation markers", () => {
    const pins: PinMap = {
      "wiki/alpha/a.md": { x: 12, y: 34, coordinateSpace: "world" }
    };
    const markers: GraphAggregationMarker[] = [
      {
        id: "agg-alpha",
        label: "Alpha overflow",
        communityId: "alpha",
        nodeIds: ["a", "b"],
        selectedNodeIds: ["a"],
        searchResultIds: ["a"],
        pinnedNodeIds: ["a"],
        totalCount: 2
      }
    ];

    const summary = summarizeGraphNode(graphFixture(), "a", {
      selection: { kind: "node", id: "a" },
      searchResultIds: ["a", "d"],
      pins,
      aggregationMarkers: markers
    });

    assert.equal(summary.kind, "node-summary");
    assert.equal(summary.nodeId, "a");
    assert.equal(summary.object.nodeId, "a");
    assert.equal(summary.communityId, "alpha");
    assert.equal(summary.searchHit, true);
    assert.deepEqual(summary.pinHint, {
      nodeId: "a",
      wikiPath: "wiki/alpha/a.md",
      pinned: true,
      position: { x: 12, y: 34, coordinateSpace: "world" }
    });
    assert.deepEqual(summary.selection.selectedNodeIds, ["a"]);
    assert.deepEqual(summary.selection.selectedCommunityIds, ["alpha"]);
    assert.equal(summary.selection.containsCurrentObject, true);
    assert.deepEqual(summary.aggregationMarkers.map((marker) => marker.id), ["agg-alpha"]);
    assert.deepEqual(summary.strongestRelations.map((relation) => relation.edgeId), ["a-c", "a-b"]);
    assert.deepEqual(summary.bridgeRelations.map((relation) => relation.edgeId), ["a-c"]);
  });

  it("keeps open-detail/read distinct from enter-community overview", () => {
    const node = summarizeGraphNode(graphFixture(), "a");
    const community = summarizeGraphCommunity(graphFixture(), "alpha");

    assert.equal(node.kind, "node-summary");
    assert.equal(community.kind, "community-summary");
    assert.deepEqual(commandKinds(node.commands), ["open-detail-read", "set-fixed-position", "enter-community"]);
    assert.deepEqual(commandKinds(community.commands), ["enter-community"]);

    const openDetail = node.commands.find((command) => command.kind === "open-detail-read");
    const enterCommunity = node.commands.find((command) => command.kind === "enter-community");

    assert.deepEqual(openDetail, {
      kind: "open-detail-read",
      nodeId: "a",
      path: "wiki/alpha/a.md",
      label: "打开详情"
    });
    assert.deepEqual(enterCommunity, {
      kind: "enter-community",
      communityId: "alpha",
      label: "进入社区"
    });
  });

  it("models fixed and unfixed position as explicit commands instead of node double-click behavior", () => {
    const unpinned = summarizeGraphNode(graphFixture(), "b");
    const pinned = summarizeGraphNode(graphFixture(), "b", {
      pins: {
        "wiki/alpha/b.md": { x: 4, y: 8, coordinateSpace: "world" }
      }
    });

    assert.equal(unpinned.kind, "node-summary");
    assert.equal(pinned.kind, "node-summary");

    assert.deepEqual(fixedPositionCommands(unpinned.commands), [
      {
        kind: "set-fixed-position",
        mode: "fix",
        nodeId: "b",
        wikiPath: "wiki/alpha/b.md",
        label: "固定位置"
      }
    ]);
    assert.deepEqual(fixedPositionCommands(pinned.commands), [
      {
        kind: "set-fixed-position",
        mode: "unfix",
        nodeId: "b",
        wikiPath: "wiki/alpha/b.md",
        label: "取消固定位置"
      }
    ]);
    assert.equal(commandKinds(pinned.commands).includes("node-double-click"), false);
  });

  it("preserves community ids, core nodes, search result ids, Pin hints, and selection state", () => {
    const summary = summarizeGraphCommunity(graphFixture(), "alpha", {
      selection: { kind: "community", id: "alpha" },
      searchResultIds: ["b", "d"],
      pins: {
        "wiki/alpha/a.md": { x: 1, y: 2, coordinateSpace: "world" }
      },
      aggregationMarkers: [
        { id: "agg-alpha", communityId: "alpha", nodeIds: ["a", "b"], selectedNodeIds: ["a"], searchResultIds: ["b"] }
      ]
    });

    assert.equal(summary.kind, "community-summary");
    assert.equal(summary.communityId, "alpha");
    assert.equal(summary.object.communityId, "alpha");
    assert.deepEqual(summary.coreNodeIds, ["a", "b"]);
    assert.deepEqual(summary.searchResultIds, ["b"]);
    assert.deepEqual(summary.pinHints.map((hint) => hint.nodeId), ["a"]);
    assert.deepEqual(summary.selection.selectedNodeIds, ["a", "b"]);
    assert.deepEqual(summary.selection.selectedCommunityIds, ["alpha"]);
    assert.equal(summary.selection.containsCurrentObject, true);
    assert.deepEqual(summary.aggregationMarkers.map((marker) => marker.id), ["agg-alpha"]);
  });

  it("preserves global, search, excluded, and unavailable payload identity fields", () => {
    const pins: PinMap = {
      "wiki/alpha/a.md": { x: 1, y: 1, coordinateSpace: "world" },
      "wiki/beta/c.md": { x: 2, y: 2, coordinateSpace: "world" }
    };
    const aggregationMarkers: GraphAggregationMarker[] = [
      { id: "agg-search", communityId: "beta", nodeIds: ["c", "d"], searchResultIds: ["d"], pinnedNodeIds: ["c"] }
    ];
    const global = summarizeGraphGlobal(graphFixture(), {
      selection: { kind: "node", id: "c" },
      searchResultIds: ["d"],
      pins,
      aggregationMarkers
    });
    const search = summarizeGraphSearchResults(graphFixture(), "delta", ["d", "missing"], {
      selection: { kind: "node", id: "d" },
      pins,
      aggregationMarkers
    });
    const excluded = summarizeExcludedGraphObject(
      graphFixture(),
      { kind: "aggregation", aggregationId: "agg-search", communityId: "beta", nodeIds: ["c", "d"] },
      "aggregation",
      { selection: { kind: "node", id: "c" }, pins, searchResultIds: ["d"], aggregationMarkers }
    );
    const unavailable = summarizeUnavailableGraphObject(
      graphFixture(),
      { kind: "node", nodeId: "missing" },
      "missing-node",
      { selection: { kind: "node", id: "c" }, searchResultIds: ["missing"] }
    );

    assert.deepEqual(global.coreNodeIds, ["a", "c", "b", "d"]);
    assert.deepEqual(global.searchResultIds, ["d"]);
    assert.deepEqual(global.pinHints.map((hint) => hint.nodeId), ["a", "c"]);
    assert.deepEqual(global.selection.selectedNodeIds, ["c"]);
    assert.deepEqual(global.aggregationMarkers.map((marker) => marker.id), ["agg-search"]);

    assert.deepEqual(search.searchResultIds, ["d", "missing"]);
    assert.deepEqual(search.visibleResultIds, ["d"]);
    assert.deepEqual(search.unavailableResultIds, ["missing"]);
    assert.deepEqual(search.commands.map((command) => command.kind), ["show-this-object"]);
    assert.deepEqual(search.aggregationMarkers.map((marker) => marker.id), ["agg-search"]);

    assert.equal(excluded.object.kind, "aggregation");
    assert.equal(excluded.object.aggregationId, "agg-search");
    assert.equal(excluded.reason, "aggregation");
    assert.deepEqual(excluded.searchResultIds, ["d"]);
    assert.deepEqual(excluded.pinHints.map((hint) => hint.nodeId), ["c"]);
    assert.deepEqual(commandKinds(excluded.commands), ["show-this-object", "clear-temporary-object-display"]);

    assert.equal(unavailable.kind, "unavailable-object");
    assert.equal(unavailable.object.kind, "node");
    assert.equal(unavailable.object.nodeId, "missing");
    assert.equal(unavailable.reason, "missing-node");
    assert.deepEqual(unavailable.searchResultIds, ["missing"]);
    assert.deepEqual(unavailable.selection.selectedNodeIds, ["c"]);
  });
});

function commandKinds(commands: GraphSummaryCommand[]): string[] {
  return commands.map((command) => command.kind);
}

function fixedPositionCommands(commands: GraphSummaryCommand[]): GraphSummaryCommand[] {
  return commands.filter((command) => command.kind === "set-fixed-position");
}

function graphFixture(): GraphData {
  return {
    meta: {
      build_date: "2026-06-18T00:00:00.000Z",
      wiki_title: "Summary contract graph",
      total_nodes: 4,
      total_edges: 3
    },
    nodes: [
      { id: "a", label: "Alpha hub", type: "topic", community: "alpha", source_path: "wiki/alpha/a.md", score: 3 },
      { id: "b", label: "Alpha leaf", type: "entity", community: "alpha", source_path: "wiki/alpha/b.md", weight: 2 },
      { id: "c", label: "Beta bridge", type: "topic", community: "beta", source_path: "wiki/beta/c.md", weight: 1 },
      { id: "d", label: "Beta detail", type: "source", community: "beta", source_path: "wiki/beta/d.md" }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED", relation_type: "实现", weight: 0.6 },
      { id: "a-c", from: "a", to: "c", type: "INFERRED", relation_type: "依赖", weight: 0.9 },
      { id: "c-d", from: "c", to: "d", type: "EXTRACTED", relation_type: "衍生", weight: 0.8 }
    ],
    insights: {
      surprising_connections: [],
      isolated_nodes: [],
      bridge_nodes: [{ id: "c", label: "Beta bridge", community: "beta", connected_communities: ["alpha"], community_count: 2 }],
      sparse_communities: [],
      meta: { degraded: false, node_count: 4, edge_count: 3, max_insight_nodes: 10, max_insight_edges: 10 }
    },
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "a", recommended_start_reason: "hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: ["a", "b", "c", "d"], degraded: false }
      },
      communities: [
        { id: "alpha", label: "Alpha", node_count: 2, color_index: 0, members: ["a", "b"] },
        { id: "beta", label: "Beta", node_count: 2, color_index: 1, members: ["c", "d"] }
      ]
    }
  };
}
