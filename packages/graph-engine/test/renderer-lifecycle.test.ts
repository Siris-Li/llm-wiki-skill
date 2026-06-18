import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphData, GraphDiff, SelectionInput } from "../src";
import { createGraphRenderer } from "../src/render";

describe("graph renderer lifecycle", () => {
  it("routes a global node click to lightweight selection instead of opening the page", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const opened: string[] = [];
    const selections: SelectionInput[] = [];
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false,
      onNodeOpen: (id) => opened.push(id),
      onSelectionInput: (selection) => selections.push(selection)
    });

    nodeElement(renderer, "a")?.dispatch("click", { detail: 0 });

    assert.deepEqual(opened, []);
    assert.deepEqual(selections, [{ kind: "node", id: "a" }]);
    assert.equal(nodeElement(renderer, "a")?.getAttribute("aria-pressed"), "true");

    renderer.destroy();
  });

  it("updates toolbar panel state without repainting the graph", () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false
    });

    const toolbar = findByClass(renderer.root as unknown as FakeElement, "graph-toolbar")[0];
    const filtersButton = findByText(toolbar, "筛选");
    const legendButton = findByText(toolbar, "图例");
    const panel = findByClass(toolbar, "graph-toolbar-panel")[0];
    const node = nodeElement(renderer, "a");

    filtersButton?.dispatch("click");

    assert.equal(renderer.root.dataset.toolbarPanel, "filters");
    assert.equal(toolbar.dataset.panel, "filters");
    assert.equal(panel.dataset.state, "filters");
    assert.equal(filtersButton?.dataset.active, "true");
    assert.equal(legendButton?.dataset.active, "false");
    assert.equal(findByClass(renderer.root as unknown as FakeElement, "graph-toolbar")[0], toolbar);
    assert.equal(nodeElement(renderer, "a"), node);

    renderer.destroy();
  });

  it("does not let stale diff settlement mutate a refreshed graph", async () => {
    const ownerDocument = new FakeDocument();
    const container = ownerDocument.createElement("div");
    const renderer = createGraphRenderer(container as unknown as HTMLElement, {
      data: graphData(["a"]),
      theme: "shan-shui",
      live: false
    });

    const staleDiff = renderer.applyDiff(diff({ addedNodes: ["a"], nodeCount: 1 }), { durationMs: 420 });
    assert.equal(renderer.root.dataset.diffState, "playing");
    assert.equal(nodeElement(renderer, "a")?.classList.contains("is-diff-added"), true);

    renderer.setData(graphData(["b"]));
    assert.equal(renderer.root.dataset.diffState, undefined);
    assert.equal(nodeElement(renderer, "a"), undefined);

    const currentDiff = renderer.applyDiff(diff({ addedNodes: ["b"], nodeCount: 1 }), { durationMs: 420 });
    assert.equal(renderer.root.dataset.diffState, "playing");
    assert.equal(nodeElement(renderer, "b")?.classList.contains("is-diff-added"), true);

    await staleDiff;
    assert.equal(renderer.root.dataset.diffState, "playing");
    assert.equal(nodeElement(renderer, "b")?.classList.contains("is-diff-added"), true);

    await currentDiff;
    assert.equal(renderer.root.dataset.diffState, "settled");
    assert.equal(nodeElement(renderer, "b")?.classList.contains("is-diff-added"), false);

    renderer.destroy();
  });
});

function graphData(ids: string[]): GraphData {
  return {
    meta: {
      build_date: "2026-06-17",
      wiki_title: "Lifecycle graph",
      total_nodes: ids.length,
      total_edges: 0
    },
    nodes: ids.map((id) => ({
      id,
      label: `Node ${id}`,
      type: "topic",
      community: "community-a",
      source_path: `wiki/${id}.md`,
      content: `Node ${id}`
    })),
    edges: []
  };
}

function diff(overrides: Partial<GraphDiff> & { nodeCount: number }): GraphDiff {
  return {
    addedNodes: overrides.addedNodes || [],
    removedNodes: overrides.removedNodes || [],
    recoloredNodes: overrides.recoloredNodes || [],
    addedEdges: overrides.addedEdges || [],
    removedEdges: overrides.removedEdges || [],
    newCommunities: overrides.newCommunities || [],
    stats: {
      nodeCount: overrides.nodeCount,
      edgeCount: 0,
      communityCount: 1
    }
  };
}

function nodeElement(renderer: { root: HTMLElement }, id: string): FakeElement | undefined {
  return findByDataset(renderer.root as unknown as FakeElement, "id", id);
}

function findByDataset(root: FakeElement, key: string, value: string): FakeElement | undefined {
  if (root.dataset[key] === value) return root;
  for (const child of root.children) {
    const match = findByDataset(child, key, value);
    if (match) return match;
  }
  return undefined;
}

class FakeDocument {
  readonly head = new FakeElement("head", this);
  readonly defaultView = {
    localStorage: null,
    matchMedia: () => ({ matches: false })
  };

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  createElementNS(_namespace: string, tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  getElementById(id: string): FakeElement | null {
    return findById(this.head, id) || null;
  }

  addEventListener(_type: string, _listener: unknown): void {}

  removeEventListener(_type: string, _listener: unknown): void {}
}

class FakeElement {
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly dataset: Record<string, string | undefined> = {};
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList(this);
  ownerDocument: FakeDocument;
  parentElement: FakeElement | null = null;
  className = "";
  textContent = "";
  type = "";
  title = "";
  href = "";
  innerHTML = "";
  checked = false;
  value = "";
  tabIndex = -1;
  scrollLeft = 0;
  scrollTop = 0;
  id = "";

  constructor(readonly tagName: string, ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  append(...children: Array<FakeElement | string>): void {
    for (const child of children) {
      if (typeof child === "string") {
        this.textContent += child;
      } else {
        this.appendChild(child);
      }
    }
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child: FakeElement): void {
    child.parentElement = this;
    this.children.unshift(child);
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.splice(0);
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  contains(candidate: FakeElement): boolean {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }

  setAttribute(name: string, value: string): void {
    if (name === "class") this.className = value;
    else if (name === "href") this.href = value;
    else if (name === "id") this.id = value;
    else if (name.startsWith("data-")) this.dataset[dataKey(name)] = value;
    else (this as unknown as Record<string, string>)[name] = value;
  }

  getAttribute(name: string): string | null {
    if (name === "class") return this.className;
    if (name === "href") return this.href || null;
    if (name === "id") return this.id || null;
    if (name.startsWith("data-")) return this.dataset[dataKey(name)] || null;
    const value = (this as unknown as Record<string, string>)[name];
    return value || null;
  }

  addEventListener(type: string, listener: unknown): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener as (event: FakeEvent) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: unknown): void {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type: string, init: Partial<FakeEvent> = {}): void {
    const event = new FakeEvent(type, init);
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  focus(_options?: unknown): void {}

  select(): void {}

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 960, height: 640 };
  }
}

class FakeEvent {
  propagationStopped = false;
  detail = 1;
  shiftKey = false;

  constructor(readonly type: string, init: Partial<FakeEvent> = {}) {
    Object.assign(this, init);
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class FakeStyle {
  private readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  removeProperty(name: string): string {
    const value = this.values.get(name) || "";
    this.values.delete(name);
    return value;
  }

  set colorScheme(value: string) {
    this.setProperty("color-scheme", value);
  }

  set left(value: string) {
    this.setProperty("left", value);
  }

  set top(value: string) {
    this.setProperty("top", value);
  }

  set translate(value: string) {
    this.setProperty("translate", value);
  }

  set strokeWidth(value: string) {
    this.setProperty("stroke-width", value);
  }

  set opacity(value: string) {
    this.setProperty("opacity", value);
  }

  set cursor(value: string) {
    this.setProperty("cursor", value);
  }

  set background(value: string) {
    this.setProperty("background", value);
  }
}

class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  add(...classNames: string[]): void {
    this.write([...this.read(), ...classNames]);
  }

  remove(...classNames: string[]): void {
    const remove = new Set(classNames);
    this.write(this.read().filter((className) => !remove.has(className)));
  }

  toggle(className: string, force?: boolean): void {
    const classNames = new Set(this.read());
    const shouldAdd = force ?? !classNames.has(className);
    if (shouldAdd) classNames.add(className);
    else classNames.delete(className);
    this.write([...classNames]);
  }

  contains(className: string): boolean {
    return this.read().includes(className);
  }

  private read(): string[] {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  private write(classNames: string[]): void {
    this.element.className = [...new Set(classNames)].join(" ");
  }
}

function findById(root: FakeElement, id: string): FakeElement | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findById(child, id);
    if (match) return match;
  }
  return undefined;
}

function findByClass(root: FakeElement, className: string): FakeElement[] {
  const matches: FakeElement[] = [];
  const classes = new Set(root.className.split(/\s+/).filter(Boolean));
  if (classes.has(className)) matches.push(root);
  for (const child of root.children) matches.push(...findByClass(child, className));
  return matches;
}

function findByText(root: FakeElement, text: string): FakeElement | undefined {
  if (root.textContent === text) return root;
  for (const child of root.children) {
    const match = findByText(child, text);
    if (match) return match;
  }
  return undefined;
}

function dataKey(attribute: string): string {
  return attribute.slice("data-".length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
