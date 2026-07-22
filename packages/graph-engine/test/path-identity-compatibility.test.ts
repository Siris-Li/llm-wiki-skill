import assert from "node:assert/strict";
import { describe, it } from "node:test";
import GraphologyGraph from "graphology";

import { buildAtlasModel, projectGraphInput, type GraphData } from "../src";
import { buildSigmaGlobalGraphologyGraph } from "../src/render/sigma-graphology-model";
import { prepareRendererAdapterDataForTest } from "./support/prepared-renderer-adapter";

describe("path identity compatibility", () => {
  it("preserves path ids through projection, atlas, render adapter, Graphology, and pins", () => {
    const data = pathIdentityGraph();
    const projection = projectGraphInput(data);
    const model = buildAtlasModel(projection.data);
    const pinnedPath = "wiki/topics/foo.md";
    const adapter = prepareRendererAdapterDataForTest(projection.data, {
      pins: {
        [pinnedPath]: { x: 320, y: -48, coordinateSpace: "world" }
      }
    });
    const graph = buildSigmaGlobalGraphologyGraph(adapter, { GraphologyGraph });

    assert.deepEqual(
      projection.data.nodes.map((node) => node.id),
      data.nodes.map((node) => node.id)
    );
    assert.deepEqual(
      model.nodes.map((node) => node.id),
      data.nodes.map((node) => node.id)
    );
    assert.equal(graph.order, 4);
    assert.equal(graph.size, 2);
    assert.equal(graph.hasNode("wiki/entities/foo.md"), true);
    assert.equal(graph.hasNode("wiki/topics/foo.md"), true);
    assert.equal(graph.getNodeAttribute(pinnedPath, "sourcePath"), pinnedPath);
    assert.equal(graph.getNodeAttribute(pinnedPath, "pinned"), true);
    assert.equal(graph.getNodeAttribute(pinnedPath, "x"), 320);
    assert.equal(graph.getNodeAttribute(pinnedPath, "y"), -48);
    assert.equal(graph.source("edge-1"), "wiki/sources/links.md");
    assert.equal(graph.target("edge-1"), "wiki/entities/unique.md");
  });
});

function pathIdentityGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-07-19T00:00:00Z",
      wiki_title: "path-id-test",
      total_nodes: 4,
      total_edges: 2,
      initial_view: ["wiki/sources/links.md", "wiki/entities/unique.md"]
    },
    nodes: [
      {
        id: "wiki/sources/links.md",
        source_path: "wiki/sources/links.md",
        label: "Links",
        type: "source",
        community: "source-community"
      },
      {
        id: "wiki/entities/unique.md",
        source_path: "wiki/entities/unique.md",
        label: "Unique",
        type: "entity",
        community: "source-community"
      },
      {
        id: "wiki/entities/foo.md",
        source_path: "wiki/entities/foo.md",
        label: "Entity Foo",
        type: "entity",
        community: "foo-community"
      },
      {
        id: "wiki/topics/foo.md",
        source_path: "wiki/topics/foo.md",
        label: "Topic Foo",
        type: "topic",
        community: "foo-community"
      }
    ],
    edges: [
      {
        id: "edge-1",
        from: "wiki/sources/links.md",
        to: "wiki/entities/unique.md",
        type: "EXTRACTED",
        confidence: "EXTRACTED",
        relation_type: "依赖"
      },
      {
        id: "edge-2",
        from: "wiki/sources/links.md",
        to: "wiki/topics/foo.md",
        type: "EXTRACTED",
        confidence: "EXTRACTED",
        relation_type: "依赖"
      }
    ]
  };
}
