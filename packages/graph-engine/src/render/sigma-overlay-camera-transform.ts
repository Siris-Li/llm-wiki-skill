import type { GraphScreenPoint } from "./geometry";

export interface SigmaOverlayCameraAnchorProjection {
  center: GraphScreenPoint;
  right: GraphScreenPoint;
  down: GraphScreenPoint;
}

export interface SigmaOverlayCameraAnchorWorldPoints {
  center: { x: number; y: number };
  right: { x: number; y: number };
  down: { x: number; y: number };
}

export interface SigmaOverlayCameraTransform {
  translateX: number;
  translateY: number;
  scale: number;
}

const MIN_ANCHOR_DISTANCE = 1;
// 保守阈值：拒绝边界变换后会回落到精确 reposition。快路径只是优化，
// 永远不是最终几何真值的来源。
const SCALE_TOLERANCE = 0.08;
const AXIS_ALIGNMENT_FLOOR = 0.985;

export function sigmaOverlayCameraAnchorWorldPoints(bounds: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): SigmaOverlayCameraAnchorWorldPoints {
  const center = {
    x: (finiteNumber(bounds.minX, 0) + finiteNumber(bounds.maxX, 0)) / 2,
    y: (finiteNumber(bounds.minY, 0) + finiteNumber(bounds.maxY, 0)) / 2
  };
  const spanX = Math.max(1, Math.abs(finiteNumber(bounds.maxX, center.x) - finiteNumber(bounds.minX, center.x)) / 4);
  const spanY = Math.max(1, Math.abs(finiteNumber(bounds.maxY, center.y) - finiteNumber(bounds.minY, center.y)) / 4);
  return {
    center,
    right: { x: center.x + spanX, y: center.y },
    down: { x: center.x, y: center.y + spanY }
  };
}

export function projectSigmaOverlayCameraAnchors(
  anchors: SigmaOverlayCameraAnchorWorldPoints,
  project: (point: { x: number; y: number }) => GraphScreenPoint
): SigmaOverlayCameraAnchorProjection {
  return {
    center: project(anchors.center),
    right: project(anchors.right),
    down: project(anchors.down)
  };
}

export function sigmaOverlayCameraTransform(
  baseline: SigmaOverlayCameraAnchorProjection,
  current: SigmaOverlayCameraAnchorProjection
): SigmaOverlayCameraTransform | null {
  const baseX = vector(baseline.center, baseline.right);
  const baseY = vector(baseline.center, baseline.down);
  const currentX = vector(current.center, current.right);
  const currentY = vector(current.center, current.down);
  const baseXLength = length(baseX);
  const baseYLength = length(baseY);
  const currentXLength = length(currentX);
  const currentYLength = length(currentY);
  if (
    baseXLength < MIN_ANCHOR_DISTANCE ||
    baseYLength < MIN_ANCHOR_DISTANCE ||
    currentXLength < MIN_ANCHOR_DISTANCE ||
    currentYLength < MIN_ANCHOR_DISTANCE
  ) {
    return null;
  }

  const scaleX = currentXLength / baseXLength;
  const scaleY = currentYLength / baseYLength;
  const scale = (scaleX + scaleY) / 2;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (Math.abs(scaleX - scaleY) > SCALE_TOLERANCE) return null;
  if (axisAlignment(baseX, currentX) < AXIS_ALIGNMENT_FLOOR) return null;
  if (axisAlignment(baseY, currentY) < AXIS_ALIGNMENT_FLOOR) return null;

  return {
    translateX: roundCssNumber(current.center.x - baseline.center.x * scale),
    translateY: roundCssNumber(current.center.y - baseline.center.y * scale),
    scale: roundCssNumber(scale)
  };
}

export function sigmaOverlayCameraTransformCss(transform: SigmaOverlayCameraTransform | null): string {
  if (!transform) return "";
  return `translate(${formatCssNumber(transform.translateX)}px, ${formatCssNumber(transform.translateY)}px) scale(${formatCssNumber(transform.scale)})`;
}

function vector(from: GraphScreenPoint, to: GraphScreenPoint): GraphScreenPoint {
  return { x: to.x - from.x, y: to.y - from.y };
}

function length(point: GraphScreenPoint): number {
  return Math.hypot(point.x, point.y);
}

function axisAlignment(left: GraphScreenPoint, right: GraphScreenPoint): number {
  const leftLength = length(left);
  const rightLength = length(right);
  if (leftLength < MIN_ANCHOR_DISTANCE || rightLength < MIN_ANCHOR_DISTANCE) return -1;
  return ((left.x * right.x) + (left.y * right.y)) / (leftLength * rightLength);
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundCssNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatCssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
