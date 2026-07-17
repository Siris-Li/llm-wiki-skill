import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAtlasModel,
  buildRegularSearchIndex,
  resolveAtlasSearchMatches,
  resolveAtlasSelectedNodeId,
  resolveAtlasSemanticVisibility,
  resolveRegularSearchMatches
} from "../src";

describe("Atlas search and semantic visibility", () => {
  it("keeps regular search at 500 UTF-16 units while Atlas searches the complete cleaned body", () => {
    const content = `${"a".repeat(499)}zonly-atlas-501`;
    const inputNode = { id: "boundary", label: "Boundary", type: "topic", content };
    const model = buildAtlasModel({ nodes: [inputNode], edges: [] });

    const regularAt500 = resolveRegularSearchMatches(buildRegularSearchIndex([inputNode]), "z");
    const regular = resolveRegularSearchMatches(buildRegularSearchIndex([inputNode]), "only-atlas-501");
    const atlasAt500 = resolveAtlasSearchMatches(model.searchIndex, "z");
    const atlas = resolveAtlasSearchMatches(model.searchIndex, "only-atlas-501");

    assert.deepEqual(regularAt500.matchIds, ["boundary"]);
    assert.deepEqual(regular.matchIds, []);
    assert.deepEqual(atlasAt500.matchIds, ["boundary"]);
    assert.deepEqual(atlas.matchIds, ["boundary"]);
  });

  it("matches every Atlas field without expanding the regular search contract", () => {
    const inputNode = {
      id: "atlas-id-only",
      label: "Atlas label",
      type: "topic",
      source_path: "wiki/sources/atlas-path.md",
      summary: "Atlas summary marker",
      content: `${"body ".repeat(60)}# Atlas complete body marker`
    };
    const model = buildAtlasModel({ nodes: [inputNode], edges: [] });

    for (const query of [
      "Atlas label",
      "atlas-id-only",
      "主题",
      "atlas-path.md",
      "summary marker",
      "complete body marker"
    ]) {
      assert.deepEqual(resolveAtlasSearchMatches(model.searchIndex, query).matchIds, ["atlas-id-only"], query);
    }
    assert.deepEqual(
      resolveRegularSearchMatches(buildRegularSearchIndex([inputNode]), "atlas-id-only").matchIds,
      []
    );
  });

  it("combines community focus, Atlas search, type filters, and temporary objects in one visible set", () => {
    const model = buildAtlasModel({
      nodes: [
        { id: "topic", label: "Topic", type: "topic", community: "c1" },
        { id: "entity", label: "Entity match", type: "entity", community: "c1" },
        { id: "source", label: "Source", type: "source", community: "c2" },
        { id: "external", label: "External", type: "topic", community: "c2" }
      ],
      edges: [
        { id: "internal", from: "topic", to: "entity", type: "EXTRACTED" },
        { id: "bridge", from: "entity", to: "external", type: "EXTRACTED" },
        { id: "remote", from: "external", to: "source", type: "EXTRACTED" }
      ]
    });

    const visibility = resolveAtlasSemanticVisibility(model, {
      activeCommunityId: "c1",
      query: "entity match",
      typeFilters: { topic: false, entity: true, source: true },
      temporaryObject: { kind: "node", nodeId: "external" }
    });

    assert.deepEqual(visibility.nodes.map((node) => node.id), ["entity", "external"]);
    assert.deepEqual(visibility.edges.map((edge) => edge.id), ["bridge"]);
    assert.deepEqual(visibility.contentNodes.map((node) => node.id), ["entity", "source", "external"]);
    assert.deepEqual(visibility.typeFilters, { topic: false, entity: true, source: true });
  });

  it("lets the selection owner invalidate only nodes absent from the final visible set", () => {
    const model = buildAtlasModel({
      nodes: [
        { id: "topic", label: "Topic", type: "topic", community: "c1" },
        { id: "entity", label: "Entity", type: "entity", community: "c1" }
      ],
      edges: []
    });
    const hidden = resolveAtlasSemanticVisibility(model, {
      activeCommunityId: "c1",
      typeFilters: { topic: false, entity: true }
    });
    const temporarilyShown = resolveAtlasSemanticVisibility(model, {
      activeCommunityId: "c1",
      typeFilters: { topic: false, entity: true },
      temporaryObject: { kind: "node", nodeId: "topic" }
    });

    assert.equal(resolveAtlasSelectedNodeId(model, hidden, "topic"), null);
    assert.equal(resolveAtlasSelectedNodeId(model, temporarilyShown, "topic"), "topic");
  });
});
