export interface SigmaWheelDeltaLike {
  deltaY: number;
  deltaMode?: number;
}

export type SigmaButtonZoomDirection = "in" | "out";

export const SIGMA_WHEEL_LINE_HEIGHT_PX = 18;
export const SIGMA_WHEEL_PAGE_HEIGHT_PX = 720;
export const SIGMA_WHEEL_ZOOM_SPEED = 0.0016;
export const SIGMA_WHEEL_ZOOM_FACTOR_MIN = 0.2;
export const SIGMA_WHEEL_ZOOM_FACTOR_MAX = 5;
export const SIGMA_CAMERA_MIN_RATIO = 0.3;
export const SIGMA_CAMERA_MAX_RATIO = 8;
export const SIGMA_BUTTON_ZOOM_RATIO = 1.18;
export const SIGMA_BUTTON_ZOOM_DURATION_MS = 140;

export function normalizeSigmaWheelDelta(delta: SigmaWheelDeltaLike): number {
  const value = finiteNumber(delta.deltaY, 0);
  if (delta.deltaMode === 1) return value * SIGMA_WHEEL_LINE_HEIGHT_PX;
  if (delta.deltaMode === 2) return value * SIGMA_WHEEL_PAGE_HEIGHT_PX;
  return value;
}

export function sigmaWheelZoomRatio(currentRatio: number, delta: SigmaWheelDeltaLike): number {
  const safeRatio = finiteNumber(currentRatio, 1);
  const normalizedDelta = normalizeSigmaWheelDelta(delta);
  const zoomFactor = clamp(
    Math.exp(normalizedDelta * SIGMA_WHEEL_ZOOM_SPEED),
    SIGMA_WHEEL_ZOOM_FACTOR_MIN,
    SIGMA_WHEEL_ZOOM_FACTOR_MAX
  );
  return clamp(safeRatio * zoomFactor, SIGMA_CAMERA_MIN_RATIO, SIGMA_CAMERA_MAX_RATIO);
}

export function sigmaButtonZoomRatio(currentRatio: number, direction: SigmaButtonZoomDirection): number {
  const safeRatio = finiteNumber(currentRatio, 1);
  const factor = direction === "in" ? 1 / SIGMA_BUTTON_ZOOM_RATIO : SIGMA_BUTTON_ZOOM_RATIO;
  return clamp(safeRatio * factor, SIGMA_CAMERA_MIN_RATIO, SIGMA_CAMERA_MAX_RATIO);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
