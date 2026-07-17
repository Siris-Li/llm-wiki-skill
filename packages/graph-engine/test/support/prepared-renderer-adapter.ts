import {
  buildGraphRendererAdapterData,
  buildRenderableGraph,
  type GraphRendererAdapterData,
  type RenderPolicyOptions
} from "../../src/render";
import { resolveGraphRendererSemantics } from "../../src/summary";
import type { GraphData } from "../../src/types";

export function prepareRendererAdapterDataForTest(
  data: GraphData,
  options: RenderPolicyOptions = {}
): GraphRendererAdapterData {
  return buildGraphRendererAdapterData({
    renderable: buildRenderableGraph(data, options),
    ...resolveGraphRendererSemantics(data, options),
    sourceCommunityId: options.sourceCommunityId ?? null
  });
}
