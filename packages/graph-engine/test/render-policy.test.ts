import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAtlasModel, buildRenderableGraph, deriveAtlasLayout } from "../src";
import { resolvePositionAndRangePolicy } from "../src/render/render-policy";

describe("render position and range policy", () => {
  it("resolves live positions before pins before immutable initial positions", () => {
    const model = buildAtlasModel({
      nodes: [
        { id: "a", label: "A", community: "one", source_path: "wiki/a.md", x: 20, y: 30 }
      ],
      edges: []
    });
    const layout = deriveAtlasLayout(model);
    const pins = { "wiki/a.md": { x: 700, y: 510, coordinateSpace: "world" as const } };

    const live = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions,
      pins,
      positions: { a: { x: 1220, y: -240 } }
    });
    const pinned = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions,
      pins
    });
    const initial = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions
    });

    assert.deepEqual(live.nodePositions.a, { x: 1220, y: -240 });
    assert.ok(live.contentBounds.minY <= -320, "live drag outside the initial layout expands content range");
    assert.ok(live.contentBounds.maxX >= 1300, "live drag outside the initial layout remains inside content range");
    assert.deepEqual(pinned.nodePositions.a, { x: 700, y: 510 });
    assert.deepEqual(initial.nodePositions.a, { x: 200, y: 204 });
  });

  it("keeps sparse typed-model holes out of final positions", () => {
    const sparseNodes = new Array(2);
    sparseNodes[1] = { id: "only", label: "Only" };
    const model = buildAtlasModel({ nodes: sparseNodes, edges: [] });
    const layout = deriveAtlasLayout(model);

    const policy = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions
    });

    assert.deepEqual(Object.keys(policy.nodePositions), ["only"]);
  });

  it("keeps filtered and temporary nodes from every community in content range before framing", () => {
    const data = {
      nodes: [
        { id: "near", label: "Near", type: "entity", community: "one", source_path: "wiki/near.md", x: 20, y: 30 },
        { id: "remote", label: "Remote", type: "topic", community: "two", source_path: "wiki/remote.md", x: 70, y: 70 },
        { id: "temporary", label: "Temporary", type: "source", community: "two", source_path: "wiki/temporary.md", x: 75, y: 75 }
      ],
      edges: []
    };
    const baseOptions = {
      focus: { kind: "community" as const, id: "one" },
      typeFilters: { entity: true, topic: true, source: false },
      positions: {
        remote: { x: 2200, y: 900 },
        temporary: { x: 4200, y: 1600 }
      },
      viewportSize: { width: 1600, height: 900 }
    };

    const focused = buildRenderableGraph(data, baseOptions);
    const withTemporary = buildRenderableGraph(data, {
      ...baseOptions,
      temporaryObject: { kind: "node" as const, nodeId: "temporary" }
    });

    assert.deepEqual(focused.nodes.map((node) => node.id), ["near"]);
    assert.ok(focused.contentBounds.maxX >= 2280, "remote nodes outside the focused community still define content range");
    assert.ok(focused.contentBounds.maxX < 4200, "type-filtered nodes stay outside content range");
    assert.ok(withTemporary.contentBounds.maxX >= 4280, "temporary nodes rejoin content range");
    assert.equal(withTemporary.worldBounds, withTemporary.framingBounds);
    assert.ok(Math.abs(withTemporary.framingBounds.width / withTemporary.framingBounds.height - 16 / 9) < 0.0001);
    assert.ok(withTemporary.framingBounds.minX <= withTemporary.contentBounds.minX);
    assert.ok(withTemporary.framingBounds.maxX >= withTemporary.contentBounds.maxX);
    assert.ok(withTemporary.framingBounds.minY <= withTemporary.contentBounds.minY);
    assert.ok(withTemporary.framingBounds.maxY >= withTemporary.contentBounds.maxY);
  });
});
