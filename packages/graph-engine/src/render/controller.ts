import type { NodeId, SelectionInput } from "../types";
import { pinsToPositions } from "../sim";
import type { GraphWorldPoint } from "./geometry";
import {
  GraphGestureController,
  type GraphGestureActiveState,
  type GraphGestureIntent,
  type GraphGestureTargetLike
} from "./gestures";
import type { RenderPositionMap } from "./model";
import { cancelGraphNodeDrag, commitGraphNodeDrag, type GraphNodeDragSession } from "./node-drag-lifecycle";
import type { GraphRenderContext } from "./render-context";
import { beginGraphNodeDrag, resolveGraphNodeDragTarget } from "./simulation-bridge";
import type { GraphRuntimeStateSnapshot } from "./state";
import { shouldBlankClickCloseToolbar } from "./toolbar";
import { panRendererViewport, viewportAfterWheelZoom, type RendererViewportSize } from "./viewport";

export interface GraphController {
  bindViewportHandlers(): GraphGestureController;
  onGestureIntents(intents: GraphGestureIntent[], event: PointerEvent | null): void;
  syncRuntimeGestureState(): void;
  handleNodeClick(id: NodeId, additive: boolean): void;
  handleNodeDoubleClick(id: NodeId): boolean;
  handleBlankClick(): void;
}

export interface GraphControllerDelegates {
  render(): void;
  viewportSize(): RendererViewportSize;
  setViewportAnimating(enabled: boolean): void;
  resetViewState(): void;
  selectCommunity(id: string): void;
  closeToolbarPanel(): void;
  retreatFocusedView(): void;
  applyMotionFrame(positions: RenderPositionMap): void;
  markPinnedNodes(pinnedNodeIds: string[]): void;
}

export function createGraphController(context: GraphRenderContext, delegates: GraphControllerDelegates): GraphController {
  function bindViewportHandlers(): GraphGestureController {
    return new GraphGestureController(context.root, {
      stateMachine: context.gestureMachine,
      targetFromEventTarget: graphGestureTarget,
      graphTargetFromScreenPoint: context.hitTargetResolver.targetFromScreenPoint,
      onWheelZoom: (event, _decision, screenPoint) => {
        delegates.setViewportAnimating(false);
        context.viewportCommitter.schedule(viewportAfterWheelZoom(
          context.runtimeState.snapshot().viewport,
          { deltaY: event.deltaY, deltaMode: event.deltaMode },
          screenPoint,
          delegates.viewportSize(),
          { worldBounds: context.graph.worldBounds }
        ), { lightweight: true });
      },
      onPointerDown: (_event, decision) => {
        if (decision.intent !== "node-drag-candidate") context.root.focus({ preventScroll: true });
        delegates.setViewportAnimating(false);
      },
      onGestureIntents,
      onActiveStateChange: syncRuntimeGestureState,
      onBlankDoubleClick: () => {
        delegates.resetViewState();
      }
    });
  }

  function onGestureIntents(intents: GraphGestureIntent[], _event: PointerEvent | null): void {
    for (const intent of intents) {
      switch (intent.kind) {
        case "node-click":
          if (intent.nodeId) context.dom.nodeElements.get(intent.nodeId)?.focus({ preventScroll: true });
          if (intent.nodeId) handleNodeClick(intent.nodeId, intent.additive);
          break;
        case "node-drag-start":
          if (intent.nodeId) handleNodeDragStart(intent.nodeId, intent.screenPoint);
          break;
        case "node-drag-move":
          if (intent.nodeId) handleNodeDragMove(intent.nodeId, intent.pointerId, intent.screenPoint);
          break;
        case "node-drag-end":
          if (intent.nodeId) handleNodeDragEnd(intent.nodeId, intent.pointerId, intent.screenPoint);
          break;
        case "node-drag-cancel":
          if (intent.nodeId) handleNodeDragCancel(intent.nodeId, intent.pointerId);
          break;
        case "community-click":
          if (intent.communityId) delegates.selectCommunity(intent.communityId);
          break;
        case "community-click-cancelled":
          break;
        case "blank-click":
          handleBlankClick();
          break;
        case "blank-pan-start":
          context.root.dataset.viewportDragging = "true";
          break;
        case "blank-pan-move":
          context.root.dataset.viewportDragging = "true";
          context.viewportCommitter.schedule(panRendererViewport(
            context.runtimeState.snapshot().viewport,
            intent.delta,
            delegates.viewportSize(),
            { worldBounds: context.graph.worldBounds }
          ), { lightweight: true });
          break;
        case "blank-pan-end":
        case "blank-pan-cancel":
          delete context.root.dataset.viewportDragging;
          break;
      }
    }
  }

  function handleNodeClick(id: NodeId, additive: boolean): void {
    if (!additive) {
      context.runtimeState.setSelection({ kind: "node", id }, "reader");
      context.callbacks.onNodeOpen?.(id);
      delegates.render();
      focusRenderedNode(id);
      return;
    }
    const nextSelection = shiftSelection(id, selectedNodeIds(context.runtimeState.snapshot().selection));
    context.runtimeState.setSelection(nextSelection, "selection-panel");
    context.callbacks.onSelectionInput?.(nextSelection);
    delegates.render();
    focusRenderedNode(id);
  }

  function handleNodeDoubleClick(id: NodeId): boolean {
    if (!context.pinState.isPinned(id)) return false;
    const nextState = context.pinState.unpin(id);
    context.runtimeState.setPins(nextState.pins);
    context.simulation?.setFixed(id, null);
    delegates.markPinnedNodes(nextState.pinnedNodeIds);
    context.callbacks.onPinsChanged?.(nextState.pins);
    return true;
  }

  function focusRenderedNode(id: NodeId): void {
    context.dom.nodeElements.get(id)?.focus({ preventScroll: true });
  }

  function handleNodeDragStart(id: NodeId, screenPoint: { x: number; y: number }): void {
    if (!context.simulation) {
      context.runtimeState.setActiveGesture(null);
      return;
    }
    const active = context.runtimeState.snapshot().activeGesture;
    if (active?.kind !== "node-drag" || active.nodeId !== id) return;
    const grabOffset = active.grabOffset;
    context.dom.nodeElements.get(id)?.classList.add("is-dragging");
    context.simulation.beginDrag(id);
    context.simulation.dragTo(id, nodeDragTargetFromScreenPoint(screenPoint, grabOffset));
    context.root.dataset.dragging = id;
    context.callbacks.onDragActiveChange?.(true);
  }

  function handleNodeDragMove(id: NodeId, pointerId: number, screenPoint: { x: number; y: number }): void {
    if (!context.simulation || !isRuntimeNodeDrag(id, pointerId, true)) return;
    context.simulation.dragTo(id, nodeDragTargetFromScreenPoint(screenPoint, nodeDragGrabOffset(id, pointerId)));
  }

  function handleNodeDragEnd(id: NodeId, pointerId: number, screenPoint: { x: number; y: number }): void {
    if (!context.simulation || !isRuntimeNodeDrag(id, pointerId, true)) return;
    const result = commitGraphNodeDrag({
      nodeId: id,
      simulation: context.simulation,
      pinState: context.pinState,
      finalWorldPoint: nodeDragTargetFromScreenPoint(screenPoint, nodeDragGrabOffset(id, pointerId))
    });
    context.runtimeState.setPins(result.pins);
    delegates.applyMotionFrame(result.positions);
    delegates.markPinnedNodes(result.pinnedNodeIds);
    context.callbacks.onPinsChanged?.(result.pins);
    context.dom.nodeElements.get(id)?.classList.remove("is-dragging");
    delete context.root.dataset.dragging;
    context.runtimeState.setActiveGesture(null);
    context.callbacks.onDragActiveChange?.(false);
  }

  function handleNodeDragCancel(id: NodeId, pointerId: number): void {
    if (!context.simulation || !isRuntimeNodeDrag(id, pointerId, true)) return;
    const session = nodeDragSession(id, pointerId);
    const result = cancelGraphNodeDrag({ session, simulation: context.simulation, pinState: context.pinState });
    context.runtimeState.setPins(result.pins);
    delegates.applyMotionFrame(result.positions);
    delegates.markPinnedNodes(result.pinnedNodeIds);
    context.dom.nodeElements.get(id)?.classList.remove("is-dragging");
    delete context.root.dataset.dragging;
    context.runtimeState.setActiveGesture(null);
    context.callbacks.onDragActiveChange?.(false);
  }

  function handleBlankClick(): void {
    delete context.root.dataset.viewportDragging;
    // True blank clicks close toolbar popovers before retreating focus; drag-pan never reaches this path.
    if (shouldBlankClickCloseToolbar(context.toolbarPanelState)) {
      delegates.closeToolbarPanel();
      return;
    }
    if (context.runtimeState.snapshot().focus) delegates.retreatFocusedView();
  }

  function syncRuntimeGestureState(): void {
    const active = context.gestureMachine.snapshot();
    context.runtimeState.setActiveGesture(runtimeGestureFromActiveGesture(active));
  }

  function runtimeGestureFromActiveGesture(active: GraphGestureActiveState): GraphRuntimeStateSnapshot["activeGesture"] {
    if (!active) return null;
    if (active.kind === "node") {
      return active.nodeId
        ? {
            kind: "node-drag",
            pointerId: active.pointerId,
            nodeId: active.nodeId,
            grabOffset: nodeDragGrabOffsetFromActive(active),
            startWorldPoint: nodeDragStartWorldPoint(active.nodeId),
            wasPinned: nodeDragWasPinned(active.nodeId),
            locked: active.locked
          }
        : null;
    }
    if (active.kind === "community-wash") {
      return active.communityId
        ? {
            kind: "community-click",
            pointerId: active.pointerId,
            communityId: active.communityId,
            locked: active.locked
          }
        : null;
    }
    return {
      kind: "viewport-pan",
      pointerId: active.pointerId,
      lastScreenPoint: active.lastScreenPoint,
      locked: active.locked
    };
  }

  function graphGestureTarget(target: EventTarget | null): GraphGestureTargetLike | null {
    return target instanceof Element ? target as Element & GraphGestureTargetLike : null;
  }

  function nodeDragSession(nodeId: NodeId, pointerId: number): GraphNodeDragSession {
    const active = context.runtimeState.snapshot().activeGesture;
    if (active?.kind === "node-drag" && active.nodeId === nodeId && active.pointerId === pointerId) {
      return {
        pointerId,
        nodeId,
        startWorldPoint: active.startWorldPoint,
        wasPinned: active.wasPinned
      };
    }
    const node = context.graph.nodes.find((item) => item.id === nodeId);
    return {
      pointerId,
      nodeId,
      startWorldPoint: node?.point || { x: 0, y: 0 },
      wasPinned: context.pinState.isPinned(nodeId)
    };
  }

  function nodeDragGrabOffset(nodeId: NodeId, pointerId: number): GraphWorldPoint {
    const active = context.runtimeState.snapshot().activeGesture;
    if (active?.kind === "node-drag" && active.nodeId === nodeId && active.pointerId === pointerId) {
      return active.grabOffset;
    }
    return { x: 0, y: 0 };
  }

  function nodeDragGrabOffsetFromActive(active: NonNullable<Extract<GraphGestureActiveState, { kind: "node" }>>): GraphWorldPoint {
    const existing = context.runtimeState.snapshot().activeGesture;
    if (existing?.kind === "node-drag" && existing.nodeId === active.nodeId && existing.pointerId === active.pointerId) {
      return existing.grabOffset;
    }
    if (!active.nodeId) return { x: 0, y: 0 };
    return nodeDragStartSnapshot(active).grabOffset;
  }

  function nodeDragStartWorldPoint(nodeId: NodeId): GraphWorldPoint {
    const existing = context.runtimeState.snapshot().activeGesture;
    if (existing?.kind === "node-drag" && existing.nodeId === nodeId) return existing.startWorldPoint;
    const pinnedStartPoint = pinsToPositions(context.graph, context.runtimeState.snapshot().pins)[nodeId];
    if (pinnedStartPoint) return pinnedStartPoint;
    return context.graph.nodes.find((item) => item.id === nodeId)?.point || { x: 0, y: 0 };
  }

  function nodeDragWasPinned(nodeId: NodeId): boolean {
    const existing = context.runtimeState.snapshot().activeGesture;
    if (existing?.kind === "node-drag" && existing.nodeId === nodeId) return existing.wasPinned;
    return Boolean(pinsToPositions(context.graph, context.runtimeState.snapshot().pins)[nodeId]) || context.pinState.isPinned(nodeId);
  }

  function nodeDragStartSnapshot(active: NonNullable<Extract<GraphGestureActiveState, { kind: "node" }>>): {
    grabOffset: GraphWorldPoint;
    startWorldPoint: GraphWorldPoint;
    wasPinned: boolean;
  } {
    if (!active.nodeId) {
      return { grabOffset: { x: 0, y: 0 }, startWorldPoint: { x: 0, y: 0 }, wasPinned: false };
    }
    const node = context.graph.nodes.find((item) => item.id === active.nodeId);
    if (!node) {
      return { grabOffset: { x: 0, y: 0 }, startWorldPoint: { x: 0, y: 0 }, wasPinned: false };
    }
    const drag = beginGraphNodeDrag({
      nodeWorldPoint: node.point,
      pointerScreenPoint: active.startScreenPoint,
      viewport: context.runtimeState.snapshot().viewport,
      viewportSize: delegates.viewportSize(),
      worldBounds: context.graph.worldBounds
    });
    const pinnedStartPoint = pinsToPositions(context.graph, context.runtimeState.snapshot().pins)[active.nodeId];
    return {
      grabOffset: drag.grabOffset,
      startWorldPoint: pinnedStartPoint || drag.targetWorldPoint,
      wasPinned: Boolean(pinnedStartPoint) || context.pinState.isPinned(active.nodeId)
    };
  }

  function isRuntimeNodeDrag(nodeId: NodeId, pointerId: number, locked?: boolean): boolean {
    const active = context.runtimeState.snapshot().activeGesture;
    if (active?.kind !== "node-drag" || active.nodeId !== nodeId || active.pointerId !== pointerId) return false;
    return locked === undefined ? true : active.locked === locked;
  }

  function nodeDragTargetFromScreenPoint(screenPoint: { x: number; y: number }, grabOffset: GraphWorldPoint): GraphWorldPoint {
    return resolveGraphNodeDragTarget({
      pointerScreenPoint: screenPoint,
      viewport: context.runtimeState.snapshot().viewport,
      viewportSize: delegates.viewportSize(),
      worldBounds: context.graph.worldBounds,
      grabOffset
    });
  }

  return {
    bindViewportHandlers,
    onGestureIntents,
    syncRuntimeGestureState,
    handleNodeClick,
    handleNodeDoubleClick,
    handleBlankClick
  };
}

function selectedNodeIds(selection: SelectionInput | null): NodeId[] {
  if (!selection) return [];
  if (selection.kind === "node" || selection.kind === "neighbors") return [selection.id];
  if (selection.kind === "nodes") return selection.ids;
  return [];
}

function shiftSelection(id: NodeId, current: NodeId[]): SelectionInput {
  const selected = new Set(current);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  const ids = Array.from(selected);
  if (ids.length === 1) return { kind: "node", id: ids[0] };
  return { kind: "nodes", ids };
}
