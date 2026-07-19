import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAtlasModel, deriveAtlasLayout } from "../src";

describe("initial graph layout", () => {
  it("returns the legacy shape and world bounds without changing the typed model", () => {
    const model = buildAtlasModel({
      nodes: [
        { id: "a", label: "A", community: "outside", x: 132, y: 126 },
        { id: "b", label: "B", community: "outside", x: 148, y: 142 },
        { id: "c", label: "C", community: "outside", x: 164, y: 158 },
        { id: "missing", label: "Missing", community: "generated" }
      ],
      edges: []
    });
    const before = JSON.stringify(model);

    const layout = deriveAtlasLayout(model);
    const repeated = deriveAtlasLayout(model);

    assert.equal(JSON.stringify(model), before);
    assert.deepEqual(repeated, layout);
    assert.notEqual(layout.nodes[0], model.nodes[0]);
    assert.notEqual(repeated.nodePositions, layout.nodePositions);
    assert.deepEqual(
      layout.nodes.map((node) => [node.id, node.x, node.y]),
      [
        ["a", 14, 18],
        ["b", 30, 34],
        ["c", 46, 50],
        ["missing", 57.16, 48]
      ]
    );
    assert.deepEqual(layout.nodePositions, {
      a: { x: 140, y: 122.39999999999999 },
      b: { x: 300, y: 231.20000000000002 },
      c: { x: 460, y: 340 },
      missing: { x: 571.6, y: 326.4 }
    });
    assert.deepEqual(layout.layoutBounds, {
      minX: 0,
      minY: 0,
      maxX: 1000,
      maxY: 680,
      width: 1000,
      height: 680
    });
  });

  it("preserves sparse typed-model positions without inventing nodes", () => {
    const sparseNodes = new Array(2);
    sparseNodes[1] = { id: "only", label: "Only", community: "one" };
    const model = buildAtlasModel({ nodes: sparseNodes, edges: [] });

    const layout = deriveAtlasLayout(model);

    assert.equal(0 in layout.nodes, false);
    assert.equal(layout.nodes.length, 2);
    assert.deepEqual(layout.nodePositions.only, { x: 571.6, y: 326.4 });
  });
});
