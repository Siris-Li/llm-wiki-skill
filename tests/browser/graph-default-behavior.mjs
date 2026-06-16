import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_DEFAULT_BEHAVIOR_HTML || "";
assert.notEqual(html, "", "GRAPH_DEFAULT_BEHAVIOR_HTML must point at generated HTML");

const executablePath = process.env.GRAPH_DEFAULT_BEHAVIOR_CHROME_EXECUTABLE || "";
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await page.waitForSelector(".node");

  await page.locator(".node").first().click();
  await page.waitForSelector(".graph-reader-body");
  const computedPolicy = await graphDefaultPolicy(page);
  await page.locator(".graph-reader-close").click();
  await page.waitForSelector('.graph-reader[data-state="closed"]');

  assert.equal(computedPolicy.root.userSelect, "none", "graph root should prevent browser text selection");
  assert.equal(computedPolicy.root.touchAction, "none", "graph root should own touch and pinch gestures");
  assert.equal(computedPolicy.root.overscrollBehavior, "contain", "graph root should contain scroll chaining");
  assert.equal(computedPolicy.readerBody.userSelect, "text", "reader body should still allow selecting text");
  assert.equal(computedPolicy.searchInput.userSelect, "text", "search input should still allow text editing");

  const nodeShortcutWheel = await assertShortcutWheelZoomsGraph(page, await visibleNodeCenter(page), "node", { ctrlKey: true });
  const blankShortcutWheel = await assertShortcutWheelZoomsGraph(page, await findBlankPoint(page), "blank graph", { metaKey: true });
  const searchWheel = await assertShortcutWheelDoesNotZoomGraph(page, ".graph-search-input", "search input", { ctrlKey: true });
  const blankDrag = await assertBlankDragDoesNotSelectText(page);
  const fastReleaseDrag = await assertFastReleasePinsFinalPointerPosition(page);
  const keyboardOwnership = await assertKeyboardOwnership(page);

  console.log(JSON.stringify({
    html,
    computedPolicy,
    shortcutWheel: {
      node: nodeShortcutWheel,
      blank: blankShortcutWheel,
      searchInput: searchWheel
    },
    blankDrag,
    fastReleaseDrag,
    keyboardOwnership
  }, null, 2));
} finally {
  await browser.close();
}

async function assertShortcutWheelZoomsGraph(page, point, label, options) {
  await resetSelection(page);
  const beforeMetrics = await pageMetrics(page);
  const beforeTransform = await layerTransform(page);
  const eventResult = await dispatchWheelAt(page, point, {
    deltaY: -420,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true
  });
  assert.equal(eventResult.cancelled, true, `shortcut wheel over ${label} should cancel browser default`);
  const afterTransform = await waitForLayerTransform(page, beforeTransform);
  const afterMetrics = await pageMetrics(page);
  assert.deepEqual(afterMetrics, beforeMetrics, `shortcut wheel over ${label} should not zoom the page`);
  return {
    point: roundedPoint(point),
    beforeTransform,
    afterTransform,
    beforeMetrics,
    afterMetrics,
    eventResult
  };
}

async function assertShortcutWheelDoesNotZoomGraph(page, selector, label, options) {
  const beforeMetrics = await pageMetrics(page);
  const beforeTransform = await layerTransform(page);
  const eventResult = await dispatchWheelOnSelector(page, selector, {
    deltaY: -420,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true
  });
  assert.equal(eventResult.cancelled, false, `shortcut wheel over ${label} should remain a blocker`);
  await page.waitForTimeout(80);
  const afterTransform = await layerTransform(page);
  const afterMetrics = await pageMetrics(page);
  assert.equal(afterTransform, beforeTransform, `shortcut wheel over ${label} should not zoom graph`);
  assert.deepEqual(afterMetrics, beforeMetrics, `synthetic shortcut wheel over ${label} should not change page metrics`);
  return {
    beforeTransform,
    afterTransform,
    beforeMetrics,
    afterMetrics,
    eventResult
  };
}

async function assertBlankDragDoesNotSelectText(page) {
  await resetSelection(page);
  const point = await findBlankPoint(page);
  const toolbar = await page.locator(".graph-toolbar-actions").boundingBox();
  assert.ok(toolbar, "toolbar actions should exist for blank drag selection regression");

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(toolbar.x + toolbar.width - 4, toolbar.y + toolbar.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const state = await page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    return {
      selectionText: window.getSelection()?.toString() || "",
      viewportDragging: root?.dataset.viewportDragging || "",
      dragging: root?.dataset.dragging || ""
    };
  });
  assert.equal(state.selectionText, "", "blank graph drag should not select toolbar text");
  assert.equal(state.viewportDragging, "", "blank graph drag should not leave viewport dragging active");
  assert.equal(state.dragging, "", "blank graph drag should not leave node dragging active");
  return { start: roundedPoint(point), state };
}

async function assertFastReleasePinsFinalPointerPosition(page) {
  await page.reload();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await page.waitForSelector(".node");

  const before = await page.locator(".node").first().evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      id: node.dataset.id || "",
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      pinned: node.dataset.pinned || ""
    };
  });
  assert.notEqual(before.id, "", "fast-release drag should have a node target");

  const intermediate = { x: before.center.x + 18, y: before.center.y + 4 };
  const release = { x: before.center.x + 280, y: before.center.y + 12 };
  await dispatchPointer(page, `.node[data-id="${cssString(before.id)}"]`, "pointerdown", before.center, {
    pointerId: 77,
    button: 0,
    buttons: 1
  });
  await dispatchPointer(page, "[data-llm-wiki-graph-root='true']", "pointermove", intermediate, {
    pointerId: 77,
    button: 0,
    buttons: 1
  });
  await dispatchPointer(page, "[data-llm-wiki-graph-root='true']", "pointerup", release, {
    pointerId: 77,
    button: 0,
    buttons: 0
  });

  await page.waitForSelector(`.node[data-id="${cssString(before.id)}"][data-pinned="true"]`);
  await page.waitForTimeout(120);

  const after = await page.locator(`.node[data-id="${cssString(before.id)}"]`).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      pinned: node.dataset.pinned || ""
    };
  });
  assert.ok(
    after.center.x > before.center.x + 190,
    `fast-release drag should commit close to the release point, not the last move point: ${JSON.stringify({ before, intermediate, release, after })}`
  );
  assert.equal(after.pinned, "true", "fast-release drag should still pin the node");
  return {
    id: before.id,
    before: roundedPoint(before.center),
    intermediate: roundedPoint(intermediate),
    release: roundedPoint(release),
    after: roundedPoint(after.center),
    pinned: after.pinned
  };
}

async function assertKeyboardOwnership(page) {
  await page.reload();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector(".graph-search");

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.focus();
  });
  const outsideGraph = await dispatchDocumentKey(page, "f", { ctrlKey: true });
  await page.waitForTimeout(80);
  assert.equal(outsideGraph.defaultPrevented, false, "graph should not steal search shortcut outside graph focus");
  assert.equal(await graphSearchState(page), "closed", "search shortcut outside graph focus should not open graph search");

  await page.locator("[data-llm-wiki-graph-root='true']").evaluate((root) => root.focus({ preventScroll: true }));
  const insideGraph = await dispatchDocumentKey(page, "f", { ctrlKey: true });
  await page.waitForSelector('.graph-search[data-state="open"]');
  assert.equal(insideGraph.defaultPrevented, true, "graph should own search shortcut when graph is focused");

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.focus();
  });
  const outsideEscape = await dispatchDocumentKey(page, "Escape");
  await page.waitForTimeout(80);
  assert.equal(outsideEscape.defaultPrevented, false, "graph should not steal Escape outside graph focus");
  assert.equal(await graphSearchState(page), "open", "Escape outside graph focus should not close graph search");

  return {
    outsideGraph,
    insideGraph,
    outsideEscape,
    finalSearchState: await graphSearchState(page)
  };
}

async function layerTransform(page) {
  return page.locator("[data-viewport-layer='true']").evaluate((element) => element.style.transform);
}

async function waitForLayerTransform(page, previous) {
  await page.waitForFunction(
    (previous) => document.querySelector("[data-viewport-layer='true']")?.style.transform !== previous,
    previous,
    { timeout: 3000 }
  );
  return layerTransform(page);
}

async function pageMetrics(page) {
  return page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    visualViewportScale: window.visualViewport?.scale || 1,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight
  }));
}

async function graphDefaultPolicy(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".llm-wiki-graph-engine");
    const readerBody = document.querySelector(".graph-reader-body");
    const searchInput = document.querySelector(".graph-search-input");
    if (!root || !readerBody || !searchInput) throw new Error("Missing graph policy elements");
    const styleOf = (element) => {
      const style = getComputedStyle(element);
      return {
        userSelect: style.userSelect,
        touchAction: style.touchAction,
        overscrollBehavior: style.overscrollBehavior
      };
    };
    return {
      root: styleOf(root),
      readerBody: styleOf(readerBody),
      searchInput: styleOf(searchInput)
    };
  });
}

async function visibleNodeCenter(page) {
  return page.locator(".node").first().evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function findBlankPoint(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) throw new Error("Missing graph root");
    const rootRect = root.getBoundingClientRect();
    const blocked = ".node,.community-wash,.edge,.graph-toolbar,.mini-map,.graph-search,.graph-reader,.graph-selection-panel";
    for (let y = rootRect.top + 86; y < rootRect.bottom - 48; y += 34) {
      for (let x = rootRect.left + 40; x < rootRect.right - 40; x += 42) {
        const element = document.elementFromPoint(x, y);
        if (element && root.contains(element) && !element.closest(blocked)) return { x, y };
      }
    }
    throw new Error("Could not find blank graph point");
  });
}

async function dispatchWheelAt(page, point, options) {
  return page.evaluate(({ point, options }) => {
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) throw new Error(`No event target at ${JSON.stringify(point)}`);
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      deltaY: options.deltaY,
      deltaMode: 0,
      ctrlKey: options.ctrlKey,
      metaKey: options.metaKey
    });
    const dispatchResult = target.dispatchEvent(event);
    return {
      cancelled: !dispatchResult,
      defaultPrevented: event.defaultPrevented,
      target: target.closest(".node") ? "node" : target.closest(".community-wash") ? "community-wash" : target.className?.toString?.() || target.tagName
    };
  }, { point, options });
}

async function dispatchWheelOnSelector(page, selector, options) {
  return page.evaluate(({ selector, options }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing selector ${selector}`);
    const rect = target.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: options.deltaY,
      deltaMode: 0,
      ctrlKey: options.ctrlKey,
      metaKey: options.metaKey
    });
    const dispatchResult = target.dispatchEvent(event);
    return {
      cancelled: !dispatchResult,
      defaultPrevented: event.defaultPrevented,
      target: selector
    };
  }, { selector, options });
}

async function dispatchPointer(page, selector, type, point, options) {
  return page.evaluate(({ selector, type, point, options }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing selector ${selector}`);
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: options.pointerId,
      pointerType: "mouse",
      clientX: point.x,
      clientY: point.y,
      button: options.button,
      buttons: options.buttons,
      isPrimary: true
    });
    const dispatchResult = target.dispatchEvent(event);
    return {
      cancelled: !dispatchResult,
      defaultPrevented: event.defaultPrevented
    };
  }, { selector, type, point, options });
}

async function dispatchDocumentKey(page, key, options = {}) {
  return page.evaluate(({ key, options }) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: options.ctrlKey === true,
      metaKey: options.metaKey === true
    });
    const dispatchResult = document.dispatchEvent(event);
    return {
      cancelled: !dispatchResult,
      defaultPrevented: event.defaultPrevented,
      activeTag: document.activeElement?.tagName || ""
    };
  }, { key, options });
}

async function graphSearchState(page) {
  return page.locator(".graph-search").evaluate((element) => element.dataset.state || "");
}

async function resetSelection(page) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

function roundedPoint(point) {
  return {
    x: Math.round(point.x * 1000) / 1000,
    y: Math.round(point.y * 1000) / 1000
  };
}

function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
