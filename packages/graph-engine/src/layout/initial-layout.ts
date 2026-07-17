import type { NodeId } from "../types";
import type { AtlasEdge, AtlasModel, AtlasNode } from "../model/atlas";
import type { GraphWorldBounds, GraphWorldPoint } from "../render/geometry";

export interface AtlasLayout {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  nodePositions: Partial<Record<NodeId, GraphWorldPoint>>;
  layoutBounds: GraphWorldBounds;
}

const COMMUNITY_CENTERS = [
  { x: 50, y: 48 },
  { x: 30, y: 34 },
  { x: 70, y: 36 },
  { x: 30, y: 72 },
  { x: 72, y: 70 },
  { x: 18, y: 52 },
  { x: 84, y: 52 },
  { x: 50, y: 78 }
] as const;

const INITIAL_WORLD_WIDTH = 1000;
const INITIAL_WORLD_HEIGHT = 680;
const INITIAL_BOUNDS_PADDING = 80;

export function deriveAtlasLayout(model: AtlasModel): AtlasLayout {
  const communityIndex = new Map<string, number>();
  model.communities.forEach((community, index) => {
    communityIndex.set(community.id, index);
  });
  const grouped = new Map<string, AtlasNode[]>();

  model.nodes.forEach((node) => {
    const group = grouped.get(node.community) ?? [];
    group.push({ ...node });
    grouped.set(node.community, group);
  });

  for (const [communityId, nodes] of grouped) {
    nodes.sort((left, right) => right.priority - left.priority);
    const center = COMMUNITY_CENTERS[(communityIndex.get(communityId) ?? 0) % COMMUNITY_CENTERS.length];
    const explicitNodes = nodes.filter(hasExplicitPosition);
    const rawBounds = explicitNodes.reduce(
      (bounds, node) => ({
        minX: Math.min(bounds.minX, Number(node.x)),
        minY: Math.min(bounds.minY, Number(node.y)),
        maxX: Math.max(bounds.maxX, Number(node.x)),
        maxY: Math.max(bounds.maxY, Number(node.y))
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );
    const rawWidth = Math.max(0, rawBounds.maxX - rawBounds.minX);
    const rawHeight = Math.max(0, rawBounds.maxY - rawBounds.minY);
    const shouldNormalizeExplicitShape = explicitNodes.length === nodes.length
      && explicitNodes.length > 1
      && (rawWidth > 0 || rawHeight > 0)
      && explicitNodes.some((node) => (
        Number(node.x) < 5 || Number(node.x) > 95 || Number(node.y) < 8 || Number(node.y) > 92
      ));
    const rawCenterX = (rawBounds.minX + rawBounds.maxX) / 2;
    const rawCenterY = (rawBounds.minY + rawBounds.maxY) / 2;
    const relativeScale = shouldNormalizeExplicitShape
      ? Math.min(
          1,
          rawWidth > 0 ? 62 / rawWidth : 1,
          rawHeight > 0 ? 54 / rawHeight : 1
        )
      : 1;

    nodes.forEach((node, index) => {
      if (hasExplicitPosition(node)) {
        node.x = shouldNormalizeExplicitShape
          ? clamp(center.x + (Number(node.x) - rawCenterX) * relativeScale, 5, 95)
          : clamp(Number(node.x), 5, 95);
        node.y = shouldNormalizeExplicitShape
          ? clamp(center.y + (Number(node.y) - rawCenterY) * relativeScale, 8, 92)
          : clamp(Number(node.y), 8, 92);
        return;
      }

      const ring = Math.floor(index / 8);
      const ringIndex = index % 8;
      const angle = (ringIndex / Math.min(8, Math.max(1, nodes.length))) * Math.PI * 2 + ring * 0.42;
      const radiusX = 7 + ring * 5 + Math.min(5, nodes.length * 0.16);
      const radiusY = 5 + ring * 4 + Math.min(4, nodes.length * 0.12);
      node.x = clamp(center.x + Math.cos(angle) * radiusX, 5, 95);
      node.y = clamp(center.y + Math.sin(angle) * radiusY, 8, 92);
    });
  }

  const positionedByIndex = new Map<number, AtlasNode>();
  for (const nodes of grouped.values()) {
    for (const node of nodes) positionedByIndex.set(node.idx, node);
  }
  const nodes = model.nodes.map((node) => positionedByIndex.get(node.idx) ?? { ...node });
  const nodePositions: Partial<Record<NodeId, GraphWorldPoint>> = {};
  nodes.forEach((node) => {
    nodePositions[node.id] = atlasNodePoint(node);
  });

  return {
    nodes,
    edges: model.edges.slice(),
    nodePositions,
    layoutBounds: initialBounds(Object.values(nodePositions))
  };
}

export function atlasNodePoint(node: Pick<AtlasNode, "x" | "y">): GraphWorldPoint {
  return {
    x: finitePercentCoordinate(node.x, 50, 0, 100) / 100 * INITIAL_WORLD_WIDTH,
    y: finitePercentCoordinate(node.y, 50, 0, 100) / 100 * INITIAL_WORLD_HEIGHT
  };
}

function hasExplicitPosition(node: AtlasNode): boolean {
  return node.x != null
    && node.y != null
    && Number.isFinite(Number(node.x))
    && Number.isFinite(Number(node.y));
}

function initialBounds(points: Array<GraphWorldPoint | undefined>): GraphWorldBounds {
  let minX = 0;
  let minY = 0;
  let maxX = INITIAL_WORLD_WIDTH;
  let maxY = INITIAL_WORLD_HEIGHT;
  for (const point of points) {
    if (!point) continue;
    minX = Math.min(minX, point.x - INITIAL_BOUNDS_PADDING);
    minY = Math.min(minY, point.y - INITIAL_BOUNDS_PADDING);
    maxX = Math.max(maxX, point.x + INITIAL_BOUNDS_PADDING);
    maxY = Math.max(maxY, point.y + INITIAL_BOUNDS_PADDING);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finitePercentCoordinate(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : fallback, min, max);
}
