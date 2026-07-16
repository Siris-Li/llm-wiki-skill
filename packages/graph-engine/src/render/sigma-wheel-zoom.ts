import type { GraphScreenPoint } from "./geometry";
import { GraphWheelController } from "./gestures";
import { sigmaWheelZoomRatio, type SigmaWheelDeltaLike } from "./sigma-zoom";

interface SigmaGlobalWheelPayload {
  clientX?: unknown;
  clientY?: unknown;
  ctrlKey?: unknown;
  metaKey?: unknown;
  deltaY?: unknown;
  deltaMode?: unknown;
  target?: unknown;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export interface SigmaWheelZoomController {
  destroy(): void;
}

export interface SigmaWheelZoomControllerInput {
  root: HTMLElement;
  viewportRoot: HTMLElement;
  isDestroyed: () => boolean;
  currentRatio: () => number;
  onZoomAtPoint: (point: GraphScreenPoint, nextRatio: number) => void;
  onFatalError?: (error: unknown) => void;
}

export function bindSigmaWheelZoomController(input: SigmaWheelZoomControllerInput): SigmaWheelZoomController {
  const controller = new GraphWheelController(input.root, {
    capture: true,
    stopPropagation: true,
    isEnabled: () => !input.isDestroyed(),
    screenPointFromEvent: (event) => sigmaWheelInputFromPayload(event, input.viewportRoot)?.point || sigmaViewportCenter(input.viewportRoot),
    onWheelZoom: (event, _decision, point) => {
      const wheel = sigmaWheelInputFromPayload(event, input.viewportRoot);
      if (!wheel) return;
      const nextRatio = sigmaWheelZoomRatio(input.currentRatio(), wheel.delta);
      input.onZoomAtPoint(point, nextRatio);
    },
    onFatalError: input.onFatalError
  });
  return {
    destroy() {
      controller.destroy();
    }
  };
}

export function sigmaWheelInputFromPayload(payload: unknown, viewportRoot: HTMLElement): {
  point: GraphScreenPoint;
  delta: SigmaWheelDeltaLike;
} | null {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const deltaY = typeof wheel?.deltaY === "number" ? wheel.deltaY : null;
  if (deltaY == null || !Number.isFinite(deltaY)) return null;

  const rect = typeof viewportRoot.getBoundingClientRect === "function" ? viewportRoot.getBoundingClientRect() : null;
  const clientX = finiteNumber(wheel?.clientX, Number.NaN);
  const clientY = finiteNumber(wheel?.clientY, Number.NaN);
  const point = Number.isFinite(clientX) && Number.isFinite(clientY)
    ? {
        x: clientX - finiteNumber(rect?.left, 0),
        y: clientY - finiteNumber(rect?.top, 0)
      }
    : sigmaViewportCenter(viewportRoot);
  return {
    point,
    delta: {
      deltaY,
      deltaMode: typeof wheel?.deltaMode === "number" ? wheel.deltaMode : 0
    }
  };
}

export function sigmaViewportCenter(root: HTMLElement): GraphScreenPoint {
  const rect = typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect() : null;
  const width = finiteNumber(rect?.width, 1000);
  const height = finiteNumber(rect?.height, 680);
  return {
    x: width / 2,
    y: height / 2
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
