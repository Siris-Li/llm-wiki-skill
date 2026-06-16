import type { GraphScreenPoint, GraphWorldPoint } from "./geometry";
import { screenPointToWorldPoint } from "./geometry";
import type { RendererViewport, RendererViewportSize } from "./viewport";

export interface GraphNodeDragStartInput {
  nodeWorldPoint: GraphWorldPoint;
  pointerScreenPoint: GraphScreenPoint;
  viewport: RendererViewport;
  viewportSize: RendererViewportSize;
}

export interface GraphNodeDragMoveInput {
  pointerScreenPoint: GraphScreenPoint;
  viewport: RendererViewport;
  viewportSize: RendererViewportSize;
  grabOffset: GraphWorldPoint;
}

export interface GraphNodeDragStartState {
  pointerWorldPoint: GraphWorldPoint;
  grabOffset: GraphWorldPoint;
  targetWorldPoint: GraphWorldPoint;
}

export function beginGraphNodeDrag(input: GraphNodeDragStartInput): GraphNodeDragStartState {
  const pointerWorldPoint = screenPointToWorldPoint(input.pointerScreenPoint, input.viewport, input.viewportSize);
  const nodeWorldPoint = normalizeWorldPoint(input.nodeWorldPoint);
  const grabOffset = {
    x: pointerWorldPoint.x - nodeWorldPoint.x,
    y: pointerWorldPoint.y - nodeWorldPoint.y
  };
  return {
    pointerWorldPoint,
    grabOffset,
    targetWorldPoint: nodeWorldPoint
  };
}

export function resolveGraphNodeDragTarget(input: GraphNodeDragMoveInput): GraphWorldPoint {
  const pointerWorldPoint = screenPointToWorldPoint(input.pointerScreenPoint, input.viewport, input.viewportSize);
  const grabOffset = normalizeWorldPoint(input.grabOffset);
  return {
    x: pointerWorldPoint.x - grabOffset.x,
    y: pointerWorldPoint.y - grabOffset.y
  };
}

function normalizeWorldPoint(point: GraphWorldPoint): GraphWorldPoint {
  return {
    x: finiteNumber(point.x, 0),
    y: finiteNumber(point.y, 0)
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
