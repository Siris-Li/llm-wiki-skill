import type { CommunityId, NodeId } from "../types";

export type GraphGestureTargetKind =
  | "graph-blank"
  | "node"
  | "community-wash"
  | "edge"
  | "minimap"
  | "toolbar"
  | "search"
  | "legend"
  | "drawer"
  | "text-control"
  | "unknown";

export interface GraphGestureTargetLike {
  closest?: (selector: string) => GraphGestureTargetLike | null;
  dataset?: Record<string, string | undefined>;
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

export type GraphGestureTarget =
  | { kind: "graph-blank" }
  | { kind: "node"; id: NodeId | null }
  | { kind: "community-wash"; id: CommunityId | null }
  | { kind: "edge"; id: string | null }
  | { kind: "minimap" }
  | { kind: "toolbar" }
  | { kind: "search" }
  | { kind: "legend" }
  | { kind: "drawer" }
  | { kind: "text-control" }
  | { kind: "unknown" };

export type GraphWheelTargetDecision =
  | { intent: "zoom"; target: GraphGestureTarget }
  | { intent: "blocked"; target: GraphGestureTarget };

export type GraphPointerDownTargetDecision =
  | { intent: "node-drag-candidate"; target: Extract<GraphGestureTarget, { kind: "node" }> }
  | { intent: "community-click-candidate"; target: Extract<GraphGestureTarget, { kind: "community-wash" }> }
  | { intent: "blank-pan-candidate"; target: Extract<GraphGestureTarget, { kind: "graph-blank" }> }
  | { intent: "blocked"; target: Exclude<GraphGestureTarget, { kind: "node" | "community-wash" | "graph-blank" }> };

const TEXT_CONTROL_SELECTOR = "textarea, select, [contenteditable=\"true\"], [data-graph-text-control=\"true\"]";

const SEARCH_SELECTOR = ".graph-search";
const TOOLBAR_SELECTOR = ".graph-toolbar";
const LEGEND_SELECTOR = ".community-legend";
const DRAWER_SELECTOR = ".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]";
const MINIMAP_SELECTOR = ".mini-map";
const NODE_SELECTOR = ".node";
const COMMUNITY_WASH_SELECTOR = ".community-wash";
const EDGE_SELECTOR = ".edge";

export function classifyGraphEventTarget(target: GraphGestureTargetLike | null | undefined): GraphGestureTarget {
  if (!target) return { kind: "unknown" };
  if (isTextEditingTarget(target) || closest(target, TEXT_CONTROL_SELECTOR)) return { kind: "text-control" };
  if (closest(target, SEARCH_SELECTOR)) return { kind: "search" };
  if (closest(target, LEGEND_SELECTOR)) return { kind: "legend" };
  if (closest(target, TOOLBAR_SELECTOR)) return { kind: "toolbar" };
  if (closest(target, DRAWER_SELECTOR)) return { kind: "drawer" };
  if (closest(target, MINIMAP_SELECTOR)) return { kind: "minimap" };

  const node = closest(target, NODE_SELECTOR);
  if (node) return { kind: "node", id: dataValue(node, "id", "nodeId") };

  const communityWash = closest(target, COMMUNITY_WASH_SELECTOR);
  if (communityWash) return { kind: "community-wash", id: dataValue(communityWash, "communityId", "id") };

  const edge = closest(target, EDGE_SELECTOR);
  if (edge) return { kind: "edge", id: dataValue(edge, "edgeId", "id") };

  return { kind: "graph-blank" };
}

export function classifyGraphWheelTarget(target: GraphGestureTargetLike | null | undefined): GraphWheelTargetDecision {
  const graphTarget = classifyGraphEventTarget(target);
  switch (graphTarget.kind) {
    case "graph-blank":
    case "node":
    case "community-wash":
    case "edge":
      return { intent: "zoom", target: graphTarget };
    default:
      return { intent: "blocked", target: graphTarget };
  }
}

export function classifyGraphPointerDownTarget(target: GraphGestureTargetLike | null | undefined): GraphPointerDownTargetDecision {
  const graphTarget = classifyGraphEventTarget(target);
  switch (graphTarget.kind) {
    case "node":
      return { intent: "node-drag-candidate", target: graphTarget };
    case "community-wash":
      return { intent: "community-click-candidate", target: graphTarget };
    case "graph-blank":
      return { intent: "blank-pan-candidate", target: graphTarget };
    default:
      return { intent: "blocked", target: graphTarget };
  }
}

function closest(target: GraphGestureTargetLike, selector: string): GraphGestureTargetLike | null {
  return typeof target.closest === "function" ? target.closest(selector) : null;
}

function dataValue(target: GraphGestureTargetLike, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = target.dataset?.[key];
    if (value) return value;
  }
  return null;
}

function isTextEditingTarget(target: GraphGestureTargetLike): boolean {
  if (target.isContentEditable) return true;
  const tagName = target.tagName?.toLowerCase();
  if (!tagName) return false;
  if (tagName === "textarea" || tagName === "select") return true;
  if (tagName !== "input") return false;
  const type = String(target.type || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
}
