import type { GraphData } from "../types";
import { buildAtlasModel, type AtlasModel, type AtlasVisibleSnapshot } from "../model/atlas";
import { deriveAtlasLayout, type AtlasLayout } from "../layout/initial-layout";
import {
  resolveRenderPolicy,
  resolveRenderPolicyVisibility,
  type RenderableGraph,
  type RenderPolicyOptions
} from "./render-policy";

export interface RenderModelAssemblyStages<TModel, TLayout, TVisibility, TResult> {
  buildModel(data: GraphData): TModel;
  deriveLayout(model: TModel): TLayout;
  resolveVisibility(model: TModel, layout: TLayout, options: RenderPolicyOptions): TVisibility;
  resolvePolicy(input: {
    data: GraphData;
    model: TModel;
    layout: TLayout;
    visibility: TVisibility;
    options: RenderPolicyOptions;
  }): TResult;
}

const DEFAULT_RENDER_MODEL_STAGES: RenderModelAssemblyStages<AtlasModel, AtlasLayout, AtlasVisibleSnapshot, RenderableGraph> = {
  buildModel: buildAtlasModel,
  deriveLayout: deriveAtlasLayout,
  resolveVisibility: resolveRenderPolicyVisibility,
  resolvePolicy: resolveRenderPolicy
};

// GraphData -> typed model -> layout + semantic visibility -> shared render policy -> renderable snapshot
export function assembleRenderableGraph<TModel, TLayout, TVisibility, TResult>(
  data: GraphData,
  options: RenderPolicyOptions,
  stages: RenderModelAssemblyStages<TModel, TLayout, TVisibility, TResult>
): TResult {
  const model = stages.buildModel(data);
  const layout = stages.deriveLayout(model);
  const visibility = stages.resolveVisibility(model, layout, options);
  return stages.resolvePolicy({ data, model, layout, visibility, options });
}

export function buildRenderableGraph(data: GraphData, options: RenderPolicyOptions = {}): RenderableGraph {
  return assembleRenderableGraph(data, options, DEFAULT_RENDER_MODEL_STAGES);
}
