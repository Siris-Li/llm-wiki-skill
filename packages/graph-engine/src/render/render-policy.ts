import type { NodeId, PinMap } from "../types";
import { wikiPathForGraphNode } from "../graph-node";
import type { AtlasNode } from "../model/atlas";
import { worldBoundsForPoints, type GraphWorldBounds } from "./geometry";
import { pinPositionToWorldPoint } from "./pin-position";

export interface RenderPosition {
  x: number;
  y: number;
}

export type RenderPositionMap = Record<NodeId, RenderPosition>;
export type InitialRenderPositionMap = Partial<Record<NodeId, RenderPosition>>;

export interface PositionAndRangePolicyInput {
  nodes: readonly AtlasNode[];
  initialPositions: InitialRenderPositionMap;
  pins?: PinMap;
  positions?: RenderPositionMap;
  viewportSize?: { width: number; height: number };
  frameToViewport?: boolean;
}

export interface PositionAndRangePolicy {
  nodePositions: RenderPositionMap;
  contentBounds: GraphWorldBounds;
  framingBounds: GraphWorldBounds;
}

export function resolvePositionAndRangePolicy(input: PositionAndRangePolicyInput): PositionAndRangePolicy {
  const nodePositions: RenderPositionMap = {};
  input.nodes.forEach((node) => {
    definePosition(nodePositions, node.id, resolveNodePosition(node, input));
  });

  const contentBounds = worldBoundsForPoints(Object.values(nodePositions).filter(isPosition));
  const aspectRatio = input.frameToViewport ? viewportAspectRatio(input.viewportSize) : undefined;
  const framingBounds = aspectRatio
    ? worldBoundsForPoints(Object.values(nodePositions).filter(isPosition), { aspectRatio })
    : contentBounds;

  return { nodePositions, contentBounds, framingBounds };
}

function resolveNodePosition(
  node: AtlasNode,
  input: Pick<PositionAndRangePolicyInput, "initialPositions" | "pins" | "positions">
): RenderPosition {
  const livePosition = ownPosition(input.positions, node.id);
  if (livePosition) {
    return {
      x: finitePositionCoordinate(livePosition.x),
      y: finitePositionCoordinate(livePosition.y)
    };
  }

  const pin = input.pins?.[wikiPathForGraphNode(node)];
  if (pin) return pinPositionToWorldPoint(pin);

  const initialPosition = ownPosition(input.initialPositions, node.id);
  return initialPosition
    ? { x: initialPosition.x, y: initialPosition.y }
    : { x: 0, y: 0 };
}

function ownPosition<T extends RenderPosition>(
  positions: Partial<Record<NodeId, T>> | undefined,
  id: NodeId
): T | undefined {
  return positions && Object.hasOwn(positions, id) ? positions[id] : undefined;
}

function definePosition(positions: RenderPositionMap, id: NodeId, point: RenderPosition): void {
  Object.defineProperty(positions, id, {
    value: point,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function viewportAspectRatio(viewportSize: PositionAndRangePolicyInput["viewportSize"]): number | undefined {
  if (!viewportSize || viewportSize.width <= 0 || viewportSize.height <= 0) return undefined;
  return viewportSize.width / viewportSize.height;
}

function isPosition(position: RenderPosition | undefined): position is RenderPosition {
  return position !== undefined;
}

function finitePositionCoordinate(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
