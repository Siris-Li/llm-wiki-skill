import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assembleRenderableGraph, type RenderModelAssemblyStages } from "../src/render/model";
import type { GraphData } from "../src/types";

describe("render model assembly", () => {
  it("computes model, layout, visibility, and shared policy once per update", () => {
    const data: GraphData = { nodes: [], edges: [] };
    const calls: string[] = [];
    const model = { searchIndex: Symbol("atlas-search-index") };
    const layout = { nodePositions: Symbol("layout-positions") };
    const visibility = { nodes: Symbol("semantic-visible-nodes") };
    const renderable = { nodes: [], edges: [] };

    const stages = {
      buildModel(input) {
        calls.push("model");
        assert.equal(input, data);
        return model;
      },
      deriveLayout(input) {
        calls.push("layout");
        assert.equal(input, model);
        return layout;
      },
      resolveVisibility(inputModel, inputOptions) {
        calls.push("visibility");
        assert.equal(inputModel, model);
        assert.equal(inputModel.searchIndex, model.searchIndex, "the model's Atlas search index is reused");
        assert.deepEqual(inputOptions, {}, "semantic visibility receives policy options without layout coupling");
        return visibility;
      },
      resolvePolicy(input) {
        calls.push("policy");
        assert.equal(input.data, data);
        assert.equal(input.model, model);
        assert.equal(input.layout, layout);
        assert.equal(input.visibility, visibility);
        return renderable;
      }
    } satisfies RenderModelAssemblyStages<typeof model, typeof layout, typeof visibility, typeof renderable>;

    assert.equal(assembleRenderableGraph(data, {}, stages), renderable);
    assert.deepEqual(calls, ["model", "layout", "visibility", "policy"]);
  });
});
