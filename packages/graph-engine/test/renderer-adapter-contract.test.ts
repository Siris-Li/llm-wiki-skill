import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GRAPH_RENDERER_ADAPTER_ROUTES,
  buildRenderableGraph,
  buildGraphRendererAdapterData,
  buildGraphRendererBehaviorContract
} from "../src/render";
import { resolveGraphRendererSemantics } from "../src/summary";
import { UNGROUPED_COMMUNITY_ID } from "../src/types";
import type {
  GraphAggregationMarker,
  GraphData,
  GraphRendererAdapterData,
  GraphRendererBehaviorContract,
  PinMap,
  RenderPolicyOptions
} from "../src";

describe("graph renderer adapter contract", () => {
  it("consumes an already prepared renderable snapshot and resolved semantics", () => {
    const renderable = buildRenderableGraph(graphFixture(), {
      focus: { kind: "global" },
      searchResultIds: []
    });
    const preparedNode = renderable.nodes.find((node) => node.id === "a");
    const preparedEdge = renderable.edges.find((edge) => edge.id === "a-b");
    assert.ok(preparedNode);
    assert.ok(preparedEdge);
    preparedNode.point = { x: 901, y: 902 };
    preparedNode.community = "prepared-community";
    preparedEdge.relationType = "prepared-relation";
    preparedEdge.confidence = "PREPARED_CONFIDENCE";

    const adapter = buildGraphRendererAdapterData({
      renderable,
      selection: {
        input: { kind: "nodes", ids: ["a", "c"] },
        selectionId: "prepared-selection",
        selectedNodeIds: ["a", "c"],
        selectedCommunityIds: ["prepared-community"],
        containsCurrentObject: true
      },
      searchResultIds: ["c"],
      pinHints: [{
        nodeId: "a",
        wikiPath: "wiki/prepared-a.md",
        pinned: true,
        position: { x: 901, y: 902, coordinateSpace: "world" }
      }],
      nodes: [{ id: "a", communityId: "prepared-community" }],
      edges: [{
        id: "a-b",
        sourceNodeId: "a",
        targetNodeId: "b",
        sourceCommunityId: "prepared-source",
        targetCommunityId: "prepared-target",
        relationType: "prepared-relation",
        confidence: "PREPARED_CONFIDENCE",
        weight: 0.73
      }],
      aggregations: [{
        id: "prepared-aggregation",
        label: "Prepared aggregation",
        communityId: "prepared-community",
        nodeIds: ["a", "c"],
        selectedNodeIds: ["c"],
        searchResultIds: ["c"],
        pinnedNodeIds: ["a"],
        totalCount: 9,
        pinHints: [{
          nodeId: "a",
          wikiPath: "wiki/prepared-a.md",
          pinned: true,
          position: { x: 901, y: 902, coordinateSpace: "world" }
        }]
      }],
      sourceCommunityId: "prepared-source-context"
    });

    assert.equal(adapter.renderable, renderable);
    assert.deepEqual(adapter.nodes.find((node) => node.id === "a")?.point, { x: 901, y: 902 });
    assert.equal(adapter.nodes.find((node) => node.id === "a")?.communityId, "prepared-community");
    assert.equal(adapter.nodes.find((node) => node.id === "a")?.pinHint.wikiPath, "wiki/prepared-a.md");
    assert.equal(adapter.nodes.find((node) => node.id === "c")?.searchHit, true);
    assert.equal(adapter.edges.find((edge) => edge.id === "a-b")?.relationType, "prepared-relation");
    assert.equal(adapter.edges.find((edge) => edge.id === "a-b")?.confidence, "PREPARED_CONFIDENCE");
    assert.equal(adapter.edges.find((edge) => edge.id === "a-b")?.weight, 0.73);
    assert.equal(adapter.edges.find((edge) => edge.id === "a-b")?.sourceCommunityId, "prepared-source");
    assert.equal(adapter.aggregations[0]?.id, "prepared-aggregation");
    assert.equal(adapter.aggregations[0]?.totalCount, 9);
    assert.equal(adapter.selection.selectionId, "prepared-selection");
    assert.equal(adapter.sourceCommunityId, "prepared-source-context");
  });

  it("passes shared community local-map rules through the adapter", () => {
    const adapter = adaptGraph(graphFixture(), {
      ...adapterOptions(),
      selection: null,
      focus: { kind: "community", id: "alpha" }
    });

    assert.equal(adapter.renderable.communityMap.active, true);
    assert.equal(adapter.renderable.communityMap.current?.communityId, "alpha");
    assert.deepEqual(Object.keys(adapter.renderable.communityMap.rulesByCommunityId), ["alpha"]);
    assert.equal(adapter.renderable.communityMap.motionMode, "frozen");
    assert.ok(adapter.renderable.communityMap.current?.nodeRulesById.a);
    assert.ok(adapter.renderable.communityMap.current?.edgeRulesById["a-b"]);

    const alphaHub = adapter.nodes.find((node) => node.id === "a");
    assert.ok(alphaHub);
    assert.equal(alphaHub.render.communityMapTier, "core");
    assert.equal(typeof alphaHub.render.communityMapImportance, "number");
    assert.ok(alphaHub.render.communityMapDotSize >= 9);

    const edge = adapter.edges.find((item) => item.id === "a-b");
    assert.ok(edge);
    assert.ok(["skeleton", "related", "background"].includes(edge.render.communityMapLayer));
    assert.equal(typeof edge.render.skeleton, "boolean");
    assert.equal(typeof edge.render.traceable, "boolean");
  });

  it("passes viewport size into focused community reading bounds", () => {
    const wide = adaptGraph(graphFixture(), {
      focus: { kind: "community", id: "alpha" },
      viewportSize: { width: 1600, height: 900 }
    });
    const narrow = adaptGraph(graphFixture(), {
      focus: { kind: "community", id: "alpha" },
      viewportSize: { width: 390, height: 844 }
    });

    const wideRatio = wide.renderable.worldBounds.width / wide.renderable.worldBounds.height;
    const narrowRatio = narrow.renderable.worldBounds.width / narrow.renderable.worldBounds.height;

    assert.ok(Math.abs(wideRatio - 1600 / 900) < 0.05, `wide bounds should match viewport ratio, got ${wideRatio}`);
    assert.ok(Math.abs(narrowRatio - 390 / 844) < 0.05, `narrow bounds should match viewport ratio, got ${narrowRatio}`);
  });

  it("preserves shared object ids, selected state, search hits, Pin hints, aggregations, and drawer targets", () => {
    const adapter = adaptGraph(graphFixture(), adapterOptions());

    assert.deepEqual(adapter.nodes.map((node) => node.id), ["a", "b", "c", "d"]);
    assert.deepEqual(adapter.nodes.find((node) => node.id === "a")?.object, { kind: "node", nodeId: "a" });
    assert.deepEqual(adapter.nodes.find((node) => node.id === "a")?.drawerTarget, {
      summaryKind: "node-summary",
      object: { kind: "node", nodeId: "a" }
    });
    assert.equal(adapter.nodes.find((node) => node.id === "a")?.selected, true);
    assert.equal(adapter.nodes.find((node) => node.id === "b")?.searchHit, true);
    assert.deepEqual(adapter.nodes.find((node) => node.id === "a")?.pinHint, {
      nodeId: "a",
      wikiPath: "wiki/alpha/a.md",
      pinned: true,
      position: { x: 12, y: 34, coordinateSpace: "world" }
    });
    assert.deepEqual(adapter.nodes.find((node) => node.id === "a")?.aggregationIds, ["agg-alpha"]);

    const alpha = adapter.communities.find((community) => community.id === "alpha");
    assert.ok(alpha);
    assert.deepEqual(alpha.object, { kind: "community", communityId: "alpha" });
    assert.equal(alpha.selected, true);
    assert.deepEqual(alpha.searchResultIds, ["b"]);
    assert.deepEqual(alpha.pinHints.map((hint) => hint.nodeId), ["a"]);
    assert.deepEqual(alpha.drawerTarget, {
      summaryKind: "community-summary",
      object: { kind: "community", communityId: "alpha" }
    });
    assert.deepEqual(alpha.commands, [{ kind: "enter-community", communityId: "alpha", label: "进入社区" }]);

    const aggregation = adapter.aggregations.find((item) => item.id === "agg-alpha");
    assert.ok(aggregation);
    assert.deepEqual(aggregation.object, {
      kind: "aggregation",
      aggregationId: "agg-alpha",
      nodeIds: ["a", "b"],
      communityId: "alpha"
    });
    assert.equal(aggregation.selected, true);
    assert.deepEqual(aggregation.selectedNodeIds, ["a"]);
    assert.deepEqual(aggregation.searchResultIds, ["b"]);
    assert.deepEqual(aggregation.pinnedNodeIds, ["a"]);
    assert.deepEqual(aggregation.drawerTarget, {
      summaryKind: "community-summary",
      object: { kind: "community", communityId: "alpha" }
    });
  });

  it("defines identical behavior semantics for DOM/SVG, candidate global renderers, and aggregation fallback", () => {
    const contracts = contractsForAllRoutes();
    const domSvg = contracts.find((contract) => contract.route === "dom-svg");
    assert.ok(domSvg);

    for (const contract of contracts) {
      assert.deepEqual(stripRoute(contract), stripRoute(domSvg), `${contract.route} must keep the same graph semantics`);
    }
  });

  it("defines point select, container select, search highlight, selected aggregation, Pin aggregation, and enter-community output", () => {
    const contract = buildGraphRendererBehaviorContract(adaptGraph(graphFixture(), adapterOptions()), "candidate-global");

    assert.deepEqual(contract.pointSelect.find((item) => item.nodeId === "a"), {
      nodeId: "a",
      object: { kind: "node", nodeId: "a" },
      drawerTarget: {
        summaryKind: "node-summary",
        object: { kind: "node", nodeId: "a" }
      },
      selected: true,
      searchHit: false,
      pinHint: {
        nodeId: "a",
        wikiPath: "wiki/alpha/a.md",
        pinned: true,
        position: { x: 12, y: 34, coordinateSpace: "world" }
      },
      aggregationIds: ["agg-alpha"]
    });

    assert.deepEqual(contract.containerSelect.find((item) => item.containerId === "alpha"), {
      containerId: "alpha",
      object: { kind: "community", communityId: "alpha" },
      drawerTarget: {
        summaryKind: "community-summary",
        object: { kind: "community", communityId: "alpha" }
      },
      selected: true,
      searchResultIds: ["b"],
      pinHintNodeIds: ["a"]
    });

    assert.deepEqual(contract.containerSelect.find((item) => item.containerId === "agg-alpha"), {
      containerId: "agg-alpha",
      object: {
        kind: "aggregation",
        aggregationId: "agg-alpha",
        nodeIds: ["a", "b"],
        communityId: "alpha"
      },
      drawerTarget: {
        summaryKind: "community-summary",
        object: { kind: "community", communityId: "alpha" }
      },
      selected: true,
      searchResultIds: ["b"],
      pinHintNodeIds: ["a"]
    });

    assert.deepEqual(contract.searchHighlight, [
      {
        nodeId: "b",
        object: { kind: "node", nodeId: "b" },
        aggregationIds: ["agg-alpha"],
        drawerTarget: {
          summaryKind: "node-summary",
          object: { kind: "node", nodeId: "b" }
        }
      },
      {
        nodeId: "d",
        object: { kind: "node", nodeId: "d" },
        aggregationIds: ["agg-beta"],
        drawerTarget: {
          summaryKind: "node-summary",
          object: { kind: "node", nodeId: "d" }
        }
      }
    ]);

    assert.deepEqual(contract.selectedObjectInsideAggregation, [
      {
        aggregationId: "agg-alpha",
        object: {
          kind: "aggregation",
          aggregationId: "agg-alpha",
          nodeIds: ["a", "b"],
          communityId: "alpha"
        },
        selectedNodeIds: ["a"],
        selected: true,
        drawerTarget: {
          summaryKind: "community-summary",
          object: { kind: "community", communityId: "alpha" }
        }
      }
    ]);

    assert.deepEqual(contract.pinInsideAggregation, [
      {
        aggregationId: "agg-alpha",
        pinnedNodeIds: ["a"],
        pinHints: [
          {
            nodeId: "a",
            wikiPath: "wiki/alpha/a.md",
            pinned: true,
            position: { x: 12, y: 34, coordinateSpace: "world" }
          }
        ],
        drawerTarget: {
          summaryKind: "community-summary",
          object: { kind: "community", communityId: "alpha" }
        }
      }
    ]);

    assert.deepEqual(contract.enterCommunity.find((item) => item.communityId === "alpha"), {
      communityId: "alpha",
      command: { kind: "enter-community", communityId: "alpha", label: "进入社区" }
    });
  });

  it("exposes ungrouped adapter community node ids and drawer target", () => {
    const adapter = adaptGraph(graphFixtureWithUngroupedNodes(), {
      selection: { kind: "community", id: UNGROUPED_COMMUNITY_ID }
    });
    const ungrouped = adapter.communities.find((community) => community.id === UNGROUPED_COMMUNITY_ID);

    assert.deepEqual(ungrouped?.nodeIds, ["loose-a", "loose-b"]);
    assert.equal(ungrouped?.selected, true);
    assert.deepEqual(ungrouped?.drawerTarget, {
      summaryKind: "community-summary",
      object: { kind: "community", communityId: UNGROUPED_COMMUNITY_ID }
    });
    assert.deepEqual(ungrouped?.commands, []);
  });

  it("omits enter-community behavior for the ungrouped virtual community", () => {
    const contract = buildGraphRendererBehaviorContract(
      adaptGraph(graphFixtureWithUngroupedNodes()),
      "candidate-global"
    );

    assert.equal(contract.enterCommunity.some((item) => item.communityId === UNGROUPED_COMMUNITY_ID), false);
  });
});

function contractsForAllRoutes(): GraphRendererBehaviorContract[] {
  return GRAPH_RENDERER_ADAPTER_ROUTES.map((route) => buildGraphRendererBehaviorContract(
    adaptGraph(graphFixture(), adapterOptions()),
    route
  ));
}

function stripRoute(contract: GraphRendererBehaviorContract): Omit<GraphRendererBehaviorContract, "route"> {
  const { route: _route, ...semanticContract } = contract;
  return semanticContract;
}

function adaptGraph(data: GraphData, options: RenderPolicyOptions = {}): GraphRendererAdapterData {
  return buildGraphRendererAdapterData({
    renderable: buildRenderableGraph(data, options),
    ...resolveGraphRendererSemantics(data, options),
    sourceCommunityId: options.sourceCommunityId ?? null
  });
}

function adapterOptions(): {
  pins: PinMap;
  selection: { kind: "node"; id: "a" };
  searchResultIds: string[];
  aggregationMarkers: GraphAggregationMarker[];
} {
  return {
    pins: {
      "wiki/alpha/a.md": { x: 12, y: 34, coordinateSpace: "world" }
    },
    selection: { kind: "node", id: "a" },
    searchResultIds: ["b", "d"],
    aggregationMarkers: [
      {
        id: "agg-alpha",
        label: "Alpha overflow",
        communityId: "alpha",
        nodeIds: ["a", "b"],
        selectedNodeIds: ["a"],
        searchResultIds: ["b"],
        pinnedNodeIds: ["a"],
        totalCount: 2
      },
      {
        id: "agg-beta",
        label: "Beta overflow",
        communityId: "beta",
        nodeIds: ["c", "d"],
        searchResultIds: ["d"],
        totalCount: 2
      }
    ]
  };
}

function graphFixture(): GraphData {
  return {
    meta: {
      build_date: "2026-06-18T00:00:00.000Z",
      wiki_title: "Renderer adapter contract graph",
      total_nodes: 4,
      total_edges: 3
    },
    nodes: [
      { id: "a", label: "Alpha hub", type: "topic", community: "alpha", source_path: "wiki/alpha/a.md", score: 3, x: 10, y: 20 },
      { id: "b", label: "Alpha leaf", type: "entity", community: "alpha", source_path: "wiki/alpha/b.md", weight: 2, x: 30, y: 40 },
      { id: "c", label: "Beta bridge", type: "topic", community: "beta", source_path: "wiki/beta/c.md", weight: 1, x: 60, y: 70 },
      { id: "d", label: "Beta detail", type: "source", community: "beta", source_path: "wiki/beta/d.md", x: 90, y: 80 }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED", relation_type: "实现", weight: 0.6 },
      { id: "a-c", from: "a", to: "c", type: "INFERRED", relation_type: "依赖", weight: 0.9 },
      { id: "c-d", from: "c", to: "d", type: "EXTRACTED", relation_type: "衍生", weight: 0.8 }
    ],
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

function graphFixtureWithUngroupedNodes(): GraphData {
  const base = graphFixture();
  return {
    ...base,
    meta: {
      ...base.meta,
      total_nodes: base.meta.total_nodes + 2
    },
    nodes: [
      ...base.nodes,
      { id: "loose-a", label: "Loose A", type: "topic", community: null, source_path: "wiki/loose/a.md", score: 2, x: 20, y: 50 },
      { id: "loose-b", label: "Loose B", type: "entity", source_path: "wiki/loose/b.md", weight: 1, x: 80, y: 50 }
    ]
  };
}
