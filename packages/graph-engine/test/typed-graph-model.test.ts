import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAtlasModel } from "../src/model/atlas";

describe("typed graph model", () => {
  it("preserves sparse node array holes without inventing graph facts", () => {
    const nodes: unknown[] = [];
    nodes.length = 3;
    nodes[2] = { id: "real", label: "Real", community: "c1" };

    const model = buildAtlasModel({ nodes, edges: [] });

    assert.equal(model.nodes.length, 3);
    assert.deepEqual(Object.keys(model.nodes), ["2"]);
    assert.deepEqual(Object.keys(model.byId), ["real"]);
    assert.deepEqual(model.communities.map((community) => community.id), ["c1"]);
    assert.deepEqual(model.starts.map((entry) => entry.node.id), ["real"]);
    assert.equal(model.searchIndex.length, 3);
    assert.deepEqual(Object.keys(model.searchIndex), ["2"]);
  });

  it("normalizes malformed model input without changing collision and index semantics", () => {
    const model = buildAtlasModel({
      meta: { wiki_title: "Compatibility" },
      nodes: [
        { id: undefined, label: "generated", community: "c1", weight: undefined },
        { id: "node-0", label: "first collision", community: "c1", x: NaN, y: Infinity },
        { id: "node-0", label: "last collision", community: "c2", weight: -Infinity },
        { id: Infinity, label: "infinite id", community: null, type: "future-type", confidence: "future-confidence" }
      ],
      edges: [
        { id: undefined, from: "node-0", to: Infinity, weight: NaN },
        { id: "edge-0", from: Infinity, to: "node-0", weight: -Infinity },
        { id: "invalid", from: "missing", to: "node-0", weight: Infinity },
        { id: "duplicate", from: "node-0", to: Infinity, confidence: "future-confidence" },
        { id: "duplicate", from: Infinity, to: "node-0", relation_type: "future-relation" }
      ],
      learning: {
        entry: { recommended_start_node_id: "node-0" },
        communities: [
          { id: "c1", label: "first community", recommended_start_node_id: "node-0" },
          { id: "c1", label: "last community" }
        ]
      }
    });

    assert.deepEqual(model.nodes.map((node) => node.id), ["node-0", "node-0", "node-0", "Infinity"]);
    assert.equal(model.byId["node-0"]?.label, "last collision");
    assert.deepEqual(model.edges.map((edge) => edge.id), ["edge-0", "edge-0", "duplicate", "duplicate"]);
    assert.deepEqual(model.edges.map((edge) => [edge.source, edge.target]), [
      ["node-0", "Infinity"],
      ["Infinity", "node-0"],
      ["node-0", "Infinity"],
      ["Infinity", "node-0"]
    ]);
    assert.deepEqual(model.nodes.map((node) => node.degree), [0, 0, 4, 4]);
    assert.deepEqual(model.communities.map((community) => community.label), [
      "first community",
      "last community",
      "c2",
      "未分组"
    ]);
    assert.equal(model.communityById.c1?.label, "last community");
    assert.equal(model.starts[0]?.node.label, "last collision");
    assert.equal(model.byId.Infinity?.type, "entity");
    assert.equal(model.byId.Infinity?.confidence, "EXTRACTED");
    assert.equal(model.edges[2]?.confidence, "EXTRACTED");
    assert.equal(model.edges[3]?.relation_type, "future-relation");
  });

  it("is total for undefined and non-finite direct inputs", () => {
    assert.deepEqual(buildAtlasModel(undefined).nodes, []);
    assert.deepEqual(buildAtlasModel(NaN).nodes, []);
    assert.deepEqual(buildAtlasModel(Infinity).edges, []);
    assert.deepEqual(buildAtlasModel(-Infinity).communities, []);
  });

  it("normalizes insight numbers and keeps only typed edge signals", () => {
    const model = buildAtlasModel({
      nodes: [{ id: "a", label: "A" }],
      edges: [{
        id: "a-a",
        from: "a",
        to: "a",
        signals: {
          co_citation: "2",
          source_overlap: Infinity,
          verified: true,
          nested: { unsafe: true }
        }
      }],
      insights: {
        isolated_nodes: [{ id: 0, label: false, degree: "7", community: false }],
        meta: {
          degraded: "yes",
          node_count: "2",
          edge_count: Infinity,
          max_insight_nodes: NaN,
          max_insight_edges: "4"
        }
      }
    });

    assert.deepEqual(model.edges[0]?.signals, {
      co_citation: "2",
      source_overlap: Infinity,
      verified: true
    });
    assert.deepEqual(model.insights.isolated_nodes, [{
      id: "0",
      label: "false",
      degree: 7,
      community: "false"
    }]);
    assert.deepEqual(model.insights.meta, {
      degraded: false,
      node_count: 2,
      edge_count: 0,
      max_insight_nodes: 0,
      max_insight_edges: 4
    });
  });
});
