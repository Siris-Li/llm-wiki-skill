import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedAfterMedian,
  compareHoverMedians,
  medianOfThree
} from "./compare-issue-159-hover-baseline.mjs";

describe("issue 159 hover baseline comparison", () => {
  it("uses the locked 20 percent or 50ms formula", () => {
    assert.equal(allowedAfterMedian(100), 150);
    assert.equal(allowedAfterMedian(400), 480);
  });

  it("requires exactly three runs when calculating a median", () => {
    assert.equal(medianOfThree([31, 12, 20]), 20);
    assert.throws(() => medianOfThree([12, 20]), /exactly three/);
    assert.throws(() => medianOfThree([12, 20, 31, 45]), /exactly three/);
  });

  it("reports each renderer and shape without widening the tolerance", () => {
    const result = compareHoverMedians(
      [
        { renderer: "production", graph_shape: "nodes-1000-sparse", durations_ms: [90, 100, 110], median_ms: 100 },
        { renderer: "isolated", graph_shape: "nodes-5000-sparse", durations_ms: [390, 400, 410], median_ms: 400 }
      ],
      [
        { renderer: "production", graph_shape: "nodes-1000-sparse", durations_ms: [140, 150, 160], median_ms: 150 },
        { renderer: "isolated", graph_shape: "nodes-5000-sparse", durations_ms: [470, 480.1, 490], median_ms: 480.1 }
      ]
    );

    assert.equal(result[0]?.pass, true);
    assert.equal(result[0]?.limit_ms, 150);
    assert.equal(result[1]?.pass, false);
    assert.equal(result[1]?.limit_ms, 480);
  });

  it("rejects a declared median that does not match the three recorded runs", () => {
    assert.throws(() => compareHoverMedians(
      [{ renderer: "production", graph_shape: "nodes-1000-sparse", durations_ms: [90, 100, 110], median_ms: 100 }],
      [{ renderer: "production", graph_shape: "nodes-1000-sparse", durations_ms: [190, 200, 210], median_ms: 100 }]
    ), /candidate.*median_ms.*recorded runs/);
  });
});
