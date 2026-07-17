import type { LiveGraphSimulation, PinState } from "../sim";
import type { NodeId, PinMap, PinPosition } from "../types";
import type { RenderPositionMap } from "./render-policy";

export interface GraphNodeDragSession {
  pointerId: number;
  nodeId: NodeId;
  startWorldPoint: PinPosition;
  wasPinned: boolean;
}

export interface CommitGraphNodeDragInput {
  nodeId: NodeId;
  simulation: LiveGraphSimulation;
  pinState: PinState;
  finalWorldPoint?: PinPosition | null;
}

export interface CancelGraphNodeDragInput {
  session: GraphNodeDragSession;
  simulation: LiveGraphSimulation;
  pinState: PinState;
}

export interface CommittedGraphNodeDrag {
  kind: "committed";
  nodeId: NodeId;
  pinPosition: PinPosition;
  positions: RenderPositionMap;
  pins: PinMap;
  pinnedNodeIds: NodeId[];
}

export interface CancelledGraphNodeDrag {
  kind: "cancelled";
  nodeId: NodeId;
  restoredPosition: PinPosition;
  restoredFixed: boolean;
  positions: RenderPositionMap;
  pins: PinMap;
  pinnedNodeIds: NodeId[];
}

export function commitGraphNodeDrag(input: CommitGraphNodeDragInput): CommittedGraphNodeDrag {
  if (input.finalWorldPoint) input.simulation.dragTo(input.nodeId, normalizePosition(input.finalWorldPoint));
  const snapshot = input.simulation.endDrag({ keepFixed: true });
  const pinPosition = requirePosition(snapshot.positions, input.nodeId);
  const pinSnapshot = input.pinState.pin(input.nodeId, pinPosition);
  return {
    kind: "committed",
    nodeId: input.nodeId,
    pinPosition,
    positions: snapshot.positions,
    pins: pinSnapshot.pins,
    pinnedNodeIds: pinSnapshot.pinnedNodeIds
  };
}

export function cancelGraphNodeDrag(input: CancelGraphNodeDragInput): CancelledGraphNodeDrag {
  const restoredPosition = normalizePosition(input.session.startWorldPoint);
  const snapshot = input.simulation.endDrag({
    restore: {
      position: restoredPosition,
      fixed: input.session.wasPinned
    }
  });
  const pinSnapshot = input.pinState.snapshot();
  return {
    kind: "cancelled",
    nodeId: input.session.nodeId,
    restoredPosition,
    restoredFixed: input.session.wasPinned,
    positions: snapshot.positions,
    pins: pinSnapshot.pins,
    pinnedNodeIds: pinSnapshot.pinnedNodeIds
  };
}

// Phase 2: focused community reading freezes the free live simulation. Manual
// drag still has to work, so these helpers commit/cancel a drag WITHOUT a
// LiveGraphSimulation. They only update the dragged node's runtime position and
// the PinState; they never rebuild community bounds, rerun local-map rules, or
// restart a simulation during the gesture.
export interface FrozenGraphNodeDragInput {
  nodeId: NodeId;
  startWorldPoint: PinPosition;
  wasPinned: boolean;
  finalWorldPoint?: PinPosition | null;
  currentPositions: RenderPositionMap;
  pinState: PinState;
}

export function commitFrozenGraphNodeDrag(input: FrozenGraphNodeDragInput): CommittedGraphNodeDrag {
  const pinPosition = normalizePosition(input.finalWorldPoint || input.startWorldPoint);
  const pinSnapshot = input.pinState.pin(input.nodeId, pinPosition);
  return {
    kind: "committed",
    nodeId: input.nodeId,
    pinPosition,
    positions: { ...input.currentPositions, [input.nodeId]: { x: pinPosition.x, y: pinPosition.y } },
    pins: pinSnapshot.pins,
    pinnedNodeIds: pinSnapshot.pinnedNodeIds
  };
}

export function cancelFrozenGraphNodeDrag(input: FrozenGraphNodeDragInput): CancelledGraphNodeDrag {
  const restoredPosition = normalizePosition(input.startWorldPoint);
  // The frozen path writes no pin during the gesture, so cancel only restores
  // the dragged node's position. A previously pinned node keeps its prior pin.
  const pinSnapshot = input.wasPinned ? input.pinState.snapshot() : input.pinState.unpin(input.nodeId);
  return {
    kind: "cancelled",
    nodeId: input.nodeId,
    restoredPosition,
    restoredFixed: input.wasPinned,
    positions: { ...input.currentPositions, [input.nodeId]: { x: restoredPosition.x, y: restoredPosition.y } },
    pins: pinSnapshot.pins,
    pinnedNodeIds: pinSnapshot.pinnedNodeIds
  };
}

function requirePosition(positions: RenderPositionMap, nodeId: NodeId): PinPosition {
  const position = positions[nodeId];
  if (!position) throw new Error(`Cannot finish drag for unknown graph node: ${nodeId}`);
  return normalizePosition(position);
}

function normalizePosition(position: PinPosition): PinPosition {
  return {
    x: finiteNumber(position.x, 0),
    y: finiteNumber(position.y, 0)
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
