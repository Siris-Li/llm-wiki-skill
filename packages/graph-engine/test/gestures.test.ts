import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyGraphEventTarget,
  classifyGraphPointerDownTarget,
  classifyGraphWheelTarget,
  type GraphGestureTargetLike
} from "../src/render";

class FakeTarget implements GraphGestureTargetLike {
  readonly dataset: Record<string, string | undefined>;
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
  private readonly matchesBySelector = new Map<string, FakeTarget | null>();

  constructor(options: {
    dataset?: Record<string, string | undefined>;
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    closest?: Record<string, FakeTarget | null>;
  } = {}) {
    this.dataset = options.dataset || {};
    this.tagName = options.tagName;
    this.type = options.type;
    this.isContentEditable = options.isContentEditable;
    for (const [selector, target] of Object.entries(options.closest || {})) {
      this.matchesBySelector.set(selector, target);
    }
  }

  closest(selector: string): GraphGestureTargetLike | null {
    if (matchesSelf(this, selector)) return this;
    return this.matchesBySelector.get(selector) || null;
  }
}

describe("graph gesture target classifier", () => {
  it("classifies graph target kinds and ids without a DOM dependency", () => {
    assert.deepEqual(classifyGraphEventTarget(blankTarget()), { kind: "graph-blank" });

    assert.deepEqual(classifyGraphEventTarget(nodeTarget("node-a")), { kind: "node", id: "node-a" });
    assert.deepEqual(classifyGraphEventTarget(communityWashTarget("community-a")), { kind: "community-wash", id: "community-a" });
    assert.deepEqual(classifyGraphEventTarget(edgeTarget("edge-a")), { kind: "edge", id: "edge-a" });

    assert.deepEqual(classifyGraphEventTarget(controlTarget(".mini-map")), { kind: "minimap" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".graph-toolbar")), { kind: "toolbar" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".graph-search")), { kind: "search" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".community-legend")), { kind: "legend" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]")), { kind: "drawer" });
    assert.deepEqual(classifyGraphEventTarget(new FakeTarget({ tagName: "input", type: "search" })), { kind: "text-control" });
  });

  it("lets wheel zoom over blank, node, community wash, and edge targets", () => {
    assert.equal(classifyGraphWheelTarget(blankTarget()).intent, "zoom");
    assert.equal(classifyGraphWheelTarget(nodeTarget("node-a")).intent, "zoom");
    assert.equal(classifyGraphWheelTarget(communityWashTarget("community-a")).intent, "zoom");
    assert.equal(classifyGraphWheelTarget(edgeTarget("edge-a")).intent, "zoom");
  });

  it("blocks wheel zoom over controls, drawers, minimap, and text editing targets", () => {
    for (const target of [
      controlTarget(".graph-search"),
      controlTarget(".graph-toolbar"),
      controlTarget(".community-legend"),
      controlTarget(".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]"),
      controlTarget(".mini-map"),
      new FakeTarget({ tagName: "textarea" }),
      new FakeTarget({ tagName: "input", type: "text" }),
      new FakeTarget({ isContentEditable: true })
    ]) {
      assert.equal(classifyGraphWheelTarget(target).intent, "blocked");
    }
  });

  it("classifies pointerdown candidates for node drag, community click, and blank pan", () => {
    assert.deepEqual(classifyGraphPointerDownTarget(nodeTarget("node-a")), {
      intent: "node-drag-candidate",
      target: { kind: "node", id: "node-a" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(communityWashTarget("community-a")), {
      intent: "community-click-candidate",
      target: { kind: "community-wash", id: "community-a" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(blankTarget()), {
      intent: "blank-pan-candidate",
      target: { kind: "graph-blank" }
    });
  });

  it("blocks pointerdown over non-gesture controls", () => {
    assert.deepEqual(classifyGraphPointerDownTarget(controlTarget(".mini-map")), {
      intent: "blocked",
      target: { kind: "minimap" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(controlTarget(".graph-toolbar")), {
      intent: "blocked",
      target: { kind: "toolbar" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(new FakeTarget({ tagName: "input", type: "text" })), {
      intent: "blocked",
      target: { kind: "text-control" }
    });
  });
});

function blankTarget(): FakeTarget {
  return new FakeTarget();
}

function nodeTarget(id: string): FakeTarget {
  const node = new FakeTarget({ dataset: { id } });
  return new FakeTarget({ closest: { ".node": node } });
}

function communityWashTarget(id: string): FakeTarget {
  const wash = new FakeTarget({ dataset: { communityId: id } });
  return new FakeTarget({ closest: { ".community-wash": wash } });
}

function edgeTarget(id: string): FakeTarget {
  const edge = new FakeTarget({ dataset: { edgeId: id } });
  return new FakeTarget({ closest: { ".edge": edge } });
}

function controlTarget(selector: string): FakeTarget {
  const control = new FakeTarget();
  return new FakeTarget({ closest: { [selector]: control } });
}

function matchesSelf(target: FakeTarget, selector: string): boolean {
  if (selector.includes("[contenteditable=\"true\"]") && target.isContentEditable) return true;
  if (selector.includes("textarea") && target.tagName?.toLowerCase() === "textarea") return true;
  if (selector.includes("select") && target.tagName?.toLowerCase() === "select") return true;
  if (selector.includes("[data-graph-text-control=\"true\"]") && target.dataset.graphTextControl === "true") return true;
  return false;
}
