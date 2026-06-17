import type { NodeId } from "../types";
import type { NodeDisplayMode, RenderableNode } from "./model";

export interface GraphNodeElementHandlers {
  onNodeClick: (id: NodeId, additive: boolean) => void;
  onNodeDoubleClick: (id: NodeId) => boolean;
  onNodePreviewEnter: (id: NodeId) => void;
  onNodePreviewLeave: () => void;
}

export function createGraphNodeElement(
  ownerDocument: Document,
  node: RenderableNode,
  handlers: GraphNodeElementHandlers
): HTMLButtonElement {
  const button = ownerDocument.createElement("button");
  button.className = "node";
  if (node.unavailable) button.classList.add("is-disabled");
  applyGraphNodeDisplayMode(button, node.displayMode);
  if (node.previewStart) button.classList.add("is-preview-start");
  if (!node.labelVisible) button.classList.add("is-label-hidden");
  button.type = "button";
  button.dataset.id = node.id;
  button.dataset.type = node.type;
  button.dataset.community = node.community;
  button.dataset.visualRole = node.visualRole;
  button.dataset.startNode = node.startNode ? "true" : "false";
  button.dataset.previewStart = node.previewStart ? "true" : "false";
  button.dataset.worldX = String(node.point.x);
  button.dataset.worldY = String(node.point.y);
  button.style.left = `${node.x}%`;
  button.style.top = `${node.y}%`;
  button.title = node.label;
  button.setAttribute("aria-pressed", node.selected ? "true" : "false");
  button.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    handlers.onNodeDoubleClick(node.id);
  });
  button.addEventListener("pointerenter", () => handlers.onNodePreviewEnter(node.id));
  button.addEventListener("pointerleave", () => handlers.onNodePreviewLeave());
  button.addEventListener("focus", () => handlers.onNodePreviewEnter(node.id));
  button.addEventListener("blur", () => handlers.onNodePreviewLeave());
  bindNodeActivationHandlers(button, node.id, handlers);

  const kind = ownerDocument.createElement("span");
  kind.className = "node-kind";
  kind.textContent = node.kind;
  button.appendChild(kind);

  const name = ownerDocument.createElement("span");
  name.className = "node-name";
  name.textContent = node.label;
  button.appendChild(name);

  const meta = ownerDocument.createElement("span");
  meta.className = "node-meta";
  const spark = ownerDocument.createElement("i");
  spark.className = "spark";
  meta.appendChild(spark);
  meta.append(node.unavailable ? "来源暂不可用" : String(Math.round(node.priority || node.weight || 0)));
  button.appendChild(meta);

  return button;
}

export function applyGraphNodeDisplayMode(button: HTMLButtonElement, displayMode: NodeDisplayMode): void {
  button.classList.toggle("is-compact", displayMode === "compact-card");
  button.classList.toggle("is-point", displayMode === "point");
  button.classList.toggle("is-overview", displayMode === "overview");
  button.dataset.densityMode = displayMode;
}

function bindNodeActivationHandlers(button: HTMLButtonElement, nodeId: string, handlers: GraphNodeElementHandlers): void {
  button.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    event.stopPropagation();
    handlers.onNodeClick(nodeId, event.shiftKey);
  });
}
