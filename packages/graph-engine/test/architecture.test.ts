import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GRAPH_ARCHITECTURE_LAYERS, type GraphArchitectureLayerId } from "../src";

const EXPECTED_LAYER_ORDER: GraphArchitectureLayerId[] = [
  "data",
  "layout",
  "viewport",
  "controller",
  "renderer",
  "gestures",
  "facade"
];

describe("graph architecture layer contract", () => {
  it("declares the seven graph owner layers in one exported contract", () => {
    assert.deepEqual(GRAPH_ARCHITECTURE_LAYERS.map((layer) => layer.id), EXPECTED_LAYER_ORDER);
    assert.deepEqual(GRAPH_ARCHITECTURE_LAYERS.map((layer) => layer.name), [
      "GraphData",
      "GraphLayout",
      "GraphViewport",
      "GraphController",
      "GraphRenderer",
      "GraphGestures",
      "GraphFacade"
    ]);
  });

  it("assigns each layer real ownership and entrypoints", () => {
    for (const layer of GRAPH_ARCHITECTURE_LAYERS) {
      assert.ok(layer.owns.length >= 3, `${layer.name} should declare owned responsibilities`);
      assert.ok(layer.entrypoints.length >= 1, `${layer.name} should declare code entrypoints`);
      assert.ok(layer.mustNotOwn.length >= 3, `${layer.name} should declare forbidden responsibilities`);
      for (const entrypoint of layer.entrypoints) {
        assert.match(entrypoint, /^src\//, `${layer.name} entrypoint should stay inside graph-engine src`);
      }
    }
  });

  it("keeps host callbacks only in the facade layer", () => {
    const hostCallbackOwners = GRAPH_ARCHITECTURE_LAYERS
      .filter((layer) => layer.owns.some((item) => item.includes("host capability callbacks")))
      .map((layer) => layer.id);
    assert.deepEqual(hostCallbackOwners, ["facade"]);

    const forbiddenOutsideFacade = GRAPH_ARCHITECTURE_LAYERS
      .filter((layer) => layer.id !== "facade")
      .filter((layer) => !layer.mustNotOwn.includes("host callbacks"))
      .map((layer) => layer.id);
    assert.deepEqual(forbiddenOutsideFacade, []);
  });

  it("keeps browser event policy only in the gestures layer", () => {
    const eventPolicyOwners = GRAPH_ARCHITECTURE_LAYERS
      .filter((layer) => layer.owns.some((item) => item.includes("raw wheel")))
      .map((layer) => layer.id);
    assert.deepEqual(eventPolicyOwners, ["gestures"]);

    const renderer = GRAPH_ARCHITECTURE_LAYERS.find((layer) => layer.id === "renderer");
    assert.ok(renderer?.mustNotOwn.includes("browser default policy"));
  });

  it("assigns both search contracts and semantic visibility to data without drawing policy", () => {
    const data = GRAPH_ARCHITECTURE_LAYERS.find((layer) => layer.id === "data");

    assert.ok(data?.owns.includes("regular and Atlas search contracts"));
    assert.ok(data?.owns.includes("semantic visible node and edge sets"));
    assert.ok(data?.mustNotOwn.includes("drawing budgets"));
  });

  it("assigns cross-object render decisions to the shared render policy", () => {
    const layout = GRAPH_ARCHITECTURE_LAYERS.find((layer) => layer.id === "layout");
    const renderer = GRAPH_ARCHITECTURE_LAYERS.find((layer) => layer.id === "renderer");

    assert.ok(layout?.owns.includes("community wash and local-map geometry"));
    assert.ok(renderer?.owns.includes("shared density, display mode, and render budgets"));
    assert.ok(renderer?.owns.includes("stable cross-object priorities and community hierarchy"));
    assert.ok(renderer?.owns.includes("final positions, content bounds, and viewport framing"));
    assert.ok(renderer?.mustNotOwn.includes("graph normalization, layout, or semantic visibility algorithms"));
  });
});
