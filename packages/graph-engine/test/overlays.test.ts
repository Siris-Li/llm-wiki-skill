import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  graphEdgeHoverAnchor,
  graphNodeHoverAnchor,
  resolveGraphHoverPreviewPosition,
  worldPointToScreenPoint
} from "../src/render";
import type { RendererViewport, RendererViewportSize } from "../src/render";

const VIEWPORT_SIZE: RendererViewportSize = { width: 1000, height: 680 };

function assertNear(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `${message ?? "number"} expected ${expected}, got ${actual}`);
}

function assertPointNear(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  assertNear(actual.x, expected.x, "x");
  assertNear(actual.y, expected.y, "y");
}

describe("graph overlay anchors", () => {
  it("positions node hover anchors from projected screen points", () => {
    const viewport: RendererViewport = { x: -140, y: 82, scale: 2.25 };
    const node = { point: { x: 620, y: 260 } };

    assertPointNear(
      graphNodeHoverAnchor(node, viewport, VIEWPORT_SIZE),
      worldPointToScreenPoint(node.point, viewport, VIEWPORT_SIZE)
    );
  });

  it("positions edge hover anchors from the projected midpoint of both endpoints", () => {
    const viewport: RendererViewport = { x: 120, y: -64, scale: 1.8 };
    const source = { point: { x: 200, y: 190 } };
    const target = { point: { x: 760, y: 430 } };
    const sourceScreen = worldPointToScreenPoint(source.point, viewport, VIEWPORT_SIZE);
    const targetScreen = worldPointToScreenPoint(target.point, viewport, VIEWPORT_SIZE);

    assertPointNear(
      graphEdgeHoverAnchor({ source, target }, viewport, VIEWPORT_SIZE),
      {
        x: (sourceScreen.x + targetScreen.x) / 2,
        y: (sourceScreen.y + targetScreen.y) / 2
      }
    );
  });

  it("uses the viewport center when an edge endpoint is unavailable", () => {
    assert.deepEqual(
      graphEdgeHoverAnchor({ source: null, target: { point: { x: 760, y: 430 } } }, { x: 0, y: 0, scale: 1 }, VIEWPORT_SIZE),
      { x: 500, y: 340 }
    );
  });

  it("keeps preview cards inside the graph viewport", () => {
    assert.deepEqual(
      resolveGraphHoverPreviewPosition({
        anchorScreenPoint: { x: 990, y: 12 },
        previewSize: { width: 240, height: 150 },
        viewportSize: VIEWPORT_SIZE,
        offset: { x: 18, y: -174 },
        margin: 12
      }),
      { x: 748, y: 12 }
    );
  });
});
