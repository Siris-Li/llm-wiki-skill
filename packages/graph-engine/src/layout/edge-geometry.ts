export interface GraphEdgeGeometryPoint {
  x: number;
  y: number;
}

import type { AtlasNode } from "../model/atlas";
import { atlasNodePoint } from "./initial-layout";
import { GRAPH_WORLD_SIZE, type GraphWorldBounds } from "../render/geometry";

export interface RenderPathCache {
  getEdgeCurve(
    edge: { id: string; source: string; target: string; weight?: number },
    source: GraphEdgeGeometryPoint,
    target: GraphEdgeGeometryPoint
  ): number;
  clear(): void;
}

const GRAPH_EDGE_CONTROL_Y_OFFSET = 22;

export function graphEdgeControlPoint(
  source: GraphEdgeGeometryPoint,
  target: GraphEdgeGeometryPoint,
  curveOffset: number
): GraphEdgeGeometryPoint {
  return {
    x: (source.x + target.x) / 2 + curveOffset,
    y: (source.y + target.y) / 2 - GRAPH_EDGE_CONTROL_Y_OFFSET
  };
}

export function createRenderPathCache(): RenderPathCache {
  const edgeCurves = new Map<string, number>();
  return {
    getEdgeCurve(edge, source, target): number {
      const key = edge.id || `${edge.source}->${edge.target}`;
      const existing = edgeCurves.get(key);
      if (existing != null) return existing;
      const curve = edgeCurveOffset(source, target, edge);
      edgeCurves.set(key, curve);
      return curve;
    },
    clear(): void {
      edgeCurves.clear();
    }
  };
}

export function makeEdgePath(source: AtlasNode, target: AtlasNode, edge: { weight?: number }): string {
  const sourcePoint = atlasNodePoint(source);
  const targetPoint = atlasNodePoint(target);
  return makeEdgePathFromPoints(sourcePoint, targetPoint, edgeCurveOffset(sourcePoint, targetPoint, edge));
}

export function makeEdgePathFromPoints(
  sourcePoint: GraphEdgeGeometryPoint,
  targetPoint: GraphEdgeGeometryPoint,
  curveOffset: number
): string {
  const control = graphEdgeControlPoint(sourcePoint, targetPoint, curveOffset);
  return `M ${round(sourcePoint.x)} ${round(sourcePoint.y)} Q ${round(control.x)} ${round(control.y)} ${round(targetPoint.x)} ${round(targetPoint.y)}`;
}

export function edgeStrokeWidth(edge: { weight?: number }): number {
  return round(1.1 + normalizedEdgeWeight(edge.weight) * 1.8);
}

export function edgeOpacity(edge: { weight?: number }): number {
  return round(0.32 + normalizedEdgeWeight(edge.weight) * 0.44);
}

export function edgeVisualStrokeWidth(edge: { weight?: number }, focusedView: boolean): number {
  if (focusedView) return edgeStrokeWidth(edge);
  return round(0.95 + normalizedEdgeWeight(edge.weight) * 0.75);
}

export function edgeVisualOpacity(edge: { weight?: number }, focusedView: boolean): number {
  if (focusedView) return edgeOpacity(edge);
  return round(0.2 + normalizedEdgeWeight(edge.weight) * 0.22);
}

export function edgeRelationClass(relationType: unknown): string {
  switch (normalizeEdgeRelationText(relationType)) {
    case "实现":
      return "relation-implementation";
    case "依赖":
      return "relation-dependency";
    case "衍生":
      return "relation-derivation";
    case "对比":
      return "relation-contrast";
    case "矛盾":
      return "relation-conflict";
    default:
      return "relation-dependency";
  }
}

export function normalizeEdgeRelationText(relationType: unknown): string {
  const value = String(relationType || "依赖").trim();
  return value || "依赖";
}

export function edgeCurveOffset(
  sourcePoint: GraphEdgeGeometryPoint,
  targetPoint: GraphEdgeGeometryPoint,
  edge: { weight?: number },
  worldBounds: GraphWorldBounds = {
    minX: 0,
    minY: 0,
    maxX: GRAPH_WORLD_SIZE.width,
    maxY: GRAPH_WORLD_SIZE.height,
    width: GRAPH_WORLD_SIZE.width,
    height: GRAPH_WORLD_SIZE.height
  }
): number {
  const sourceYPercent = (sourcePoint.y - worldBounds.minY) / worldBounds.height * 100;
  const targetYPercent = (targetPoint.y - worldBounds.minY) / worldBounds.height * 100;
  return Math.max(-76, Math.min(76, (sourceYPercent - targetYPercent) * 1.8 + (normalizedEdgeWeight(edge.weight) - 0.5) * 24));
}

export function normalizedEdgeWeight(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.6;
  return Math.max(0, Math.min(1, numeric));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
