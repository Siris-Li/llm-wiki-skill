import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  projectSigmaOverlayCameraAnchors,
  sigmaOverlayCameraAnchorWorldPoints,
  sigmaOverlayCameraTransform,
  sigmaOverlayCameraTransformCss
} from "../src/render/sigma-overlay-camera-transform";

describe("sigma overlay camera transform", () => {
  it("derives a root translate and scale from stable projected anchors", () => {
    const base = {
      center: { x: 100, y: 100 },
      right: { x: 200, y: 100 },
      down: { x: 100, y: 200 }
    };
    const current = {
      center: { x: 140, y: 130 },
      right: { x: 340, y: 130 },
      down: { x: 140, y: 330 }
    };

    const transform = sigmaOverlayCameraTransform(base, current);

    assert.deepEqual(transform, {
      translateX: -60,
      translateY: -70,
      scale: 2
    });
    assert.equal(sigmaOverlayCameraTransformCss(transform), "translate(-60px, -70px) scale(2)");
  });

  it("rejects non-uniform scale because one root transform would drift", () => {
    const transform = sigmaOverlayCameraTransform(
      {
        center: { x: 100, y: 100 },
        right: { x: 200, y: 100 },
        down: { x: 100, y: 200 }
      },
      {
        center: { x: 100, y: 100 },
        right: { x: 300, y: 100 },
        down: { x: 100, y: 250 }
      }
    );

    assert.equal(transform, null);
  });

  it("rejects rotated axes because this fast path only supports translate and uniform scale", () => {
    const transform = sigmaOverlayCameraTransform(
      {
        center: { x: 100, y: 100 },
        right: { x: 200, y: 100 },
        down: { x: 100, y: 200 }
      },
      {
        center: { x: 100, y: 100 },
        right: { x: 100, y: 200 },
        down: { x: 0, y: 100 }
      }
    );

    assert.equal(transform, null);
  });

  it("builds world anchors from graph bounds and projects them through a caller function", () => {
    const anchors = sigmaOverlayCameraAnchorWorldPoints({
      minX: 0,
      maxX: 400,
      minY: 100,
      maxY: 500
    });

    assert.deepEqual(anchors, {
      center: { x: 200, y: 300 },
      right: { x: 300, y: 300 },
      down: { x: 200, y: 400 }
    });
    assert.deepEqual(
      projectSigmaOverlayCameraAnchors(anchors, (point) => ({ x: point.x / 2, y: point.y / 2 })),
      {
        center: { x: 100, y: 150 },
        right: { x: 150, y: 150 },
        down: { x: 100, y: 200 }
      }
    );
  });

  it("rejects collapsed anchors that would divide by zero", () => {
    const collapsed = {
      center: { x: 100, y: 100 },
      right: { x: 100, y: 100 },
      down: { x: 100, y: 100 }
    };
    const moved = {
      center: { x: 140, y: 130 },
      right: { x: 160, y: 130 },
      down: { x: 140, y: 150 }
    };

    assert.equal(sigmaOverlayCameraTransform(collapsed, moved), null);
  });

  it("rejects a non-finite projected scale and falls back to exact reposition", () => {
    const base = {
      center: { x: 100, y: 100 },
      right: { x: 200, y: 100 },
      down: { x: 100, y: 200 }
    };
    const nonFinite = {
      center: { x: Number.NaN, y: 100 },
      right: { x: 200, y: 100 },
      down: { x: 100, y: 200 }
    };

    assert.equal(sigmaOverlayCameraTransform(base, nonFinite), null);
  });
});
