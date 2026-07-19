import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  edgeOpacity,
  edgeRelationClass,
  edgeStrokeWidth,
  edgeVisualOpacity,
  edgeVisualStrokeWidth,
  makeEdgePath
} from "../src/layout/edge-geometry";

describe("edge drawing geometry", () => {
  it("owns path, line width, opacity, and relation-class rules without changing their outputs", () => {
    assert.equal(edgeStrokeWidth({ weight: 0 }), 1.1);
    assert.equal(edgeStrokeWidth({ weight: 1 }), 2.9);
    assert.equal(edgeOpacity({ weight: 0 }), 0.32);
    assert.equal(edgeOpacity({ weight: 1 }), 0.76);
    assert.equal(edgeVisualStrokeWidth({ weight: 1 }, false), 1.7);
    assert.equal(edgeVisualStrokeWidth({ weight: 1 }, true), 2.9);
    assert.equal(edgeVisualOpacity({ weight: 1 }, false), 0.42);
    assert.equal(edgeVisualOpacity({ weight: 1 }, true), 0.76);
    assert.equal(edgeRelationClass("实现"), "relation-implementation");
    assert.equal(edgeRelationClass("未知"), "relation-dependency");

    assert.equal(
      makeEdgePath(
        { id: "a", label: "A", type: "entity", kind: "概念", community: "c1", x: 10, y: 20 },
        { id: "b", label: "B", type: "entity", kind: "概念", community: "c1", x: 60, y: 70 },
        { weight: 0.5 }
      ),
      "M 100 136 Q 274 284 600 476"
    );
  });
});
