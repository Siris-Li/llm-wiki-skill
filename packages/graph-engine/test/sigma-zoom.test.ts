import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SIGMA_BUTTON_ZOOM_RATIO,
  SIGMA_CAMERA_MAX_RATIO,
  SIGMA_CAMERA_MIN_RATIO,
  SIGMA_WHEEL_ZOOM_SPEED,
  normalizeSigmaWheelDelta,
  sigmaButtonZoomRatio,
  sigmaWheelZoomRatio
} from "../src/render/sigma-zoom";

describe("sigma zoom math", () => {
  it("keeps the zoom constants aligned with the global zoom design", () => {
    assert.equal(SIGMA_WHEEL_ZOOM_SPEED, 0.0016);
    assert.equal(SIGMA_CAMERA_MIN_RATIO, 0.3);
    assert.equal(SIGMA_CAMERA_MAX_RATIO, 3);
    assert.equal(SIGMA_BUTTON_ZOOM_RATIO, 1.18);
  });

  it("normalizes pixel, line, and page wheel deltas", () => {
    assert.equal(normalizeSigmaWheelDelta({ deltaY: 12, deltaMode: 0 }), 12);
    assert.equal(normalizeSigmaWheelDelta({ deltaY: 2, deltaMode: 1 }), 36);
    assert.equal(normalizeSigmaWheelDelta({ deltaY: 1, deltaMode: 2 }), 720);
  });

  it("maps small wheel deltas to small ratio changes and larger deltas to larger changes", () => {
    const tiny = sigmaWheelZoomRatio(1, { deltaY: 0.25, deltaMode: 0 });
    const small = sigmaWheelZoomRatio(1, { deltaY: 4, deltaMode: 0 });
    const large = sigmaWheelZoomRatio(1, { deltaY: 80, deltaMode: 0 });

    assert.ok(tiny > 1, `tiny trackpad deltas should still produce movement, got ${tiny}`);
    assert.ok(tiny < 1.001, `tiny trackpad deltas should stay tiny, got ${tiny}`);
    assert.ok(small > 1);
    assert.ok(small < 1.01, `small trackpad deltas should barely zoom, got ${small}`);
    assert.ok(large > small, `larger wheel deltas should zoom out more than small deltas, got ${large}`);
  });

  it("maps negative wheel deltas to zoom in for Sigma ratio semantics", () => {
    const next = sigmaWheelZoomRatio(1, { deltaY: -80, deltaMode: 0 });

    assert.ok(next < 1, `negative wheel delta should reduce Sigma ratio, got ${next}`);
  });

  it("clamps wheel zoom to the Sigma camera bounds", () => {
    assert.equal(sigmaWheelZoomRatio(0.31, { deltaY: -1000, deltaMode: 0 }), SIGMA_CAMERA_MIN_RATIO);
    assert.equal(sigmaWheelZoomRatio(2.9, { deltaY: 1000, deltaMode: 0 }), SIGMA_CAMERA_MAX_RATIO);
  });

  it("uses fixed medium steps for button zoom", () => {
    assertClose(sigmaButtonZoomRatio(1, "in"), 1 / SIGMA_BUTTON_ZOOM_RATIO);
    assertClose(sigmaButtonZoomRatio(1, "out"), SIGMA_BUTTON_ZOOM_RATIO);
    assert.equal(sigmaButtonZoomRatio(0.31, "in"), SIGMA_CAMERA_MIN_RATIO);
    assert.equal(sigmaButtonZoomRatio(2.9, "out"), SIGMA_CAMERA_MAX_RATIO);
  });
});

function assertClose(actual: number, expected: number, tolerance = 0.000001): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}
