import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { atlasNodePoint, buildAtlasModel, buildRenderableGraph, deriveAtlasLayout } from "../src";
import { resolvePositionAndRangePolicy } from "../src/render/render-policy";

function positionsByIndex(layout: ReturnType<typeof deriveAtlasLayout>) {
  return new Map(layout.nodes.flatMap((node) => (
    node ? [[node.idx, atlasNodePoint(node)] as const] : []
  )));
}

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
      initialPositionsByIndex: positionsByIndex(layout),
      pins,
      positions: { a: { x: 1220, y: -240 } }
    });
    const pinned = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions,
      initialPositionsByIndex: positionsByIndex(layout),
      pins
    });
    const initial = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions,
      initialPositionsByIndex: positionsByIndex(layout)
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
      initialPositions: layout.nodePositions,
      initialPositionsByIndex: positionsByIndex(layout)
    });

    assert.deepEqual(Object.keys(policy.nodePositions), ["only"]);
  });

  it("counts positions for node ids that match object prototype properties", () => {
    const model = buildAtlasModel({
      nodes: [
        {
          id: "__proto__",
          label: "Special",
          community: "one",
          source_path: "wiki/special.md",
          x: 20,
          y: 30
        }
      ],
      edges: []
    });
    const layout = deriveAtlasLayout(model);
    const policy = resolvePositionAndRangePolicy({
      nodes: model.nodes,
      initialPositions: layout.nodePositions,
      initialPositionsByIndex: positionsByIndex(layout),
      pins: { "wiki/special.md": { x: 2200, y: 900, coordinateSpace: "world" } }
    });

    assert.equal(Object.hasOwn(layout.nodePositions, "__proto__"), true);
    assert.equal(Object.hasOwn(policy.nodePositions, "__proto__"), true);
    assert.deepEqual(policy.nodePositions.__proto__, { x: 2200, y: 900 });
    assert.ok(policy.contentBounds.maxX >= 2280);
    assert.ok(policy.contentBounds.maxY >= 980);
  });

  it("keeps duplicate ids at the initial position selected by the active type filter", () => {
    const data = {
      nodes: [
        { id: "duplicate", label: "Entity", type: "entity", community: "one", x: 10, y: 20 },
        { id: "duplicate", label: "Topic", type: "topic", community: "two", x: 90, y: 80 }
      ],
      edges: []
    };

    const entity = buildRenderableGraph(data, {
      typeFilters: { entity: true, topic: false }
    });
    const topic = buildRenderableGraph(data, {
      typeFilters: { entity: false, topic: true }
    });

    assert.deepEqual(entity.nodes.map((node) => node.point), [
      { x: 100, y: 136 },
      { x: 100, y: 136 }
    ]);
    assert.deepEqual(topic.nodes.map((node) => node.point), [
      { x: 900, y: 544 },
      { x: 900, y: 544 }
    ]);

    const model = buildAtlasModel(data);
    const layout = deriveAtlasLayout(model);
    const direct = resolvePositionAndRangePolicy({
      nodes: model.nodes.filter((node) => node.type === "entity"),
      initialPositions: layout.nodePositions,
      initialPositionsByIndex: positionsByIndex(layout)
    });
    assert.deepEqual(direct.nodePositions.duplicate, { x: 100, y: 136 });
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
