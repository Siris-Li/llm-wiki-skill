import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRenderableGraph, rendererViewportToTransform } from "../src/render";
import type { GraphData, PinMap } from "../src/types";

function sampleGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-06-13T00:00:00.000Z",
      wiki_title: "Viewport Fixture",
      total_nodes: 2,
      total_edges: 1
    },
    nodes: [
      { id: "a", label: "A", type: "topic", community: "c1", source_path: "wiki/a.md", x: 20, y: 30 },
      { id: "b", label: "B", type: "entity", community: "c1", source_path: "wiki/b.md", x: 60, y: 55 }
    ],
    edges: [{ id: "ab", from: "a", to: "b", type: "EXTRACTED", weight: 1 }]
  };
}

describe("renderer viewport state", () => {
  it("serializes pan and zoom as one content-layer transform", () => {
    assert.equal(
      rendererViewportToTransform({ x: 32.1254, y: -18.8754, scale: 1.4567 }),
      "translate(32.125px, -18.875px) scale(1.457)"
    );
  });

  it("keeps pin coordinates separate from viewport transforms", () => {
    const pins: PinMap = {
      "wiki/a.md": { x: 420, y: 210 }
    };
    const beforePins = structuredClone(pins);
    const beforeGraph = buildRenderableGraph(sampleGraph(), { pins });

    rendererViewportToTransform({ x: 120, y: -64, scale: 2.25 });
    const afterGraph = buildRenderableGraph(sampleGraph(), { pins });

    assert.deepEqual(pins, beforePins);
    assert.deepEqual(
      afterGraph.nodes.map((node) => [node.id, node.point]),
      beforeGraph.nodes.map((node) => [node.id, node.point])
    );
    assert.deepEqual(afterGraph.nodes.find((node) => node.id === "a")?.point, { x: 420, y: 210 });
  });
});
