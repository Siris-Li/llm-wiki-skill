import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_COMMUNITY_WASH_HTML || "";
assert.notEqual(html, "", "GRAPH_COMMUNITY_WASH_HTML must point at generated HTML");

const executablePath = process.env.GRAPH_COMMUNITY_WASH_CHROME_EXECUTABLE || "";
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await waitForSigmaGlobal(page);

  const initial = await sigmaSnapshot(page);
  assert.equal(initial.route, "sigma-global", "offline global route should use Sigma");
  assert.equal(initial.oldDomNodeCount, 0, "Sigma global should not render the old DOM full graph");
  assert.ok(initial.communityRegionCount >= 1, "Sigma global should expose community regions");
  assert.ok(initial.communityLabelCount >= 1 && initial.communityLabelCount <= 8, "Sigma global should expose passive map labels");
  assert.equal(initial.circularCommunityButtonCount, 0, "Sigma global should not expose circular community buttons");
  assert.equal(initial.aggregationButtonCount, 0, "Sigma global should not expose aggregation buttons");

  const communityId = await firstCommunityRegionId(page);
  const zoomOwnership = await assertCommunityRegionOwnsWheel(page, communityId);
  const regionPoint = await findCommunityRegionPoint(page, communityId);
  await page.mouse.click(regionPoint.x, regionPoint.y);
  await waitForCommunitySelection(page, communityId);
  const selected = await sigmaSnapshot(page);
  assert.equal(selected.focus, "", "clicking a community region should not enter a DOM community route");
  assert.equal(selected.selectedCommunityId, communityId, "clicking a community region should select that community");
  assert.equal(selected.oldDomNodeCount, 0, "community selection should keep the Sigma global route mounted");

  // The zoom ownership check deliberately changes the camera. Restart the legacy
  // click checks from the fixture's ordinary view so their node coordinates stay visible.
  await page.reload();
  await waitForSigmaGlobal(page);

  await setSearchQuery(page, "节点A");
  await page.waitForSelector('.sigma-global-node-hit-target[data-node-id="A"]');
  await page.locator('.sigma-global-node-hit-target[data-node-id="A"]').click({ force: true });
  await page.waitForFunction(() => (
    document.querySelector('.sigma-global-node-hit-target[data-node-id="A"]')?.getAttribute("data-selected") === "true"
  ));
  const nodeSelected = await sigmaSnapshot(page);
  assert.equal(nodeSelected.selectedNodeId, "A", "node hit target should win over the community region beneath it");
  assert.equal(nodeSelected.route, "sigma-global", "node hit target should keep the Sigma global route active");

  const labelPoint = await communityLabelCenter(page, communityId);
  await page.mouse.click(labelPoint.x, labelPoint.y);
  await waitForCommunitySelection(page, communityId);
  const labelClick = await sigmaSnapshot(page);
  assert.equal(labelClick.selectedCommunityId, communityId, "passive label area should fall through to the community region");
  assert.equal(labelClick.labelPointerEvents, "none", "community labels should stay passive");

  console.log(JSON.stringify({
    communityId,
    initial,
    zoomOwnership,
    regionPoint,
    selected,
    nodeSelected,
    labelClick
  }, null, 2));
} finally {
  await browser.close();
}

async function waitForSigmaGlobal(page) {
  await page.waitForSelector(".sigma-global-route[data-route='sigma-global']");
  await page.waitForSelector(".sigma-global-renderer[data-renderer='sigma-global']");
  await page.waitForSelector(".sigma-global-community-region[data-community-id]");
}

async function sigmaSnapshot(page) {
  return page.evaluate(() => {
    const selectedRegion = document.querySelector('.sigma-global-community-region[data-selected="true"]');
    const selectedNode = document.querySelector('.sigma-global-node-hit-target[data-selected="true"]');
    const firstLabel = document.querySelector(".sigma-global-community-label");
    return {
      route: document.querySelector(".sigma-global-route")?.getAttribute("data-route") || "",
      renderer: document.querySelector(".sigma-global-renderer")?.getAttribute("data-renderer") || "",
      focus: document.querySelector("[data-testid='offline-graph-root']")?.getAttribute("data-llm-wiki-graph-focus")
        || document.querySelector("[data-llm-wiki-graph-root='true']")?.getAttribute("data-focus")
        || "",
      oldDomNodeCount: document.querySelectorAll(".node").length,
      oldCommunityWashCount: document.querySelectorAll(".community-wash").length,
      communityRegionCount: document.querySelectorAll(".sigma-global-community-region").length,
      communityLabelCount: document.querySelectorAll(".sigma-global-community-label").length,
      circularCommunityButtonCount: document.querySelectorAll(".sigma-global-community-wash, button.sigma-global-community-label, [role='button'].sigma-global-community-label").length,
      aggregationButtonCount: document.querySelectorAll(".sigma-global-aggregation-container").length,
      selectedCommunityId: selectedRegion?.getAttribute("data-community-id") || "",
      selectedNodeId: selectedNode?.getAttribute("data-node-id") || "",
      labelPointerEvents: firstLabel ? window.getComputedStyle(firstLabel).pointerEvents : ""
    };
  });
}

async function firstCommunityRegionId(page) {
  return page.evaluate(() => {
    const region = document.querySelector(".sigma-global-community-region[data-community-id]:not([data-community-id='_none'])")
      || document.querySelector(".sigma-global-community-region[data-community-id]");
    const id = region?.getAttribute("data-community-id") || "";
    if (!id) throw new Error("Missing Sigma community region id");
    return id;
  });
}

async function findCommunityRegionPoint(page, communityId) {
  return page.evaluate((communityId) => {
    const region = document.querySelector(`.sigma-global-community-region[data-community-id="${CSS.escape(communityId)}"]`);
    if (!region) throw new Error(`Missing Sigma community region ${communityId}`);
    const rect = region.getBoundingClientRect();
    const candidates = [
      [0.5, 0.18],
      [0.2, 0.5],
      [0.8, 0.5],
      [0.5, 0.82],
      [0.32, 0.32],
      [0.68, 0.68],
      [0.5, 0.5]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      const hit = document.elementFromPoint(x, y);
      if (hit?.closest?.(".sigma-global-node-hit-target")) continue;
      if (hit?.closest?.(".sigma-global-community-region") === region) {
        return { x, y, communityId };
      }
    }
    throw new Error(`Could not find exposed Sigma community region point: ${JSON.stringify({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    })}`);
  }, communityId);
}

async function assertCommunityRegionOwnsWheel(page, communityId) {
  const point = await findCommunityRegionPoint(page, communityId);
  const before = await communityRegionGeometry(page, communityId);
  const beforeMetrics = await browserPageMetrics(page);
  const wheel = await page.evaluate(({ point, communityId }) => {
    const target = document.elementFromPoint(point.x, point.y);
    if (!(target instanceof Element)) throw new Error(`Missing wheel target at ${JSON.stringify(point)}`);
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      deltaY: -80,
      deltaMode: 0,
      ctrlKey: true
    });
    const dispatchResult = target.dispatchEvent(event);
    return {
      cancelled: !dispatchResult,
      defaultPrevented: event.defaultPrevented,
      communityId: target.closest(".sigma-global-community-region")?.getAttribute("data-community-id") || "",
      expectedCommunityId: communityId,
      targetClass: target.getAttribute("class") || ""
    };
  }, { point, communityId });
  assert.equal(wheel.communityId, communityId, "offline wheel should start on the exposed community background");
  assert.equal(wheel.cancelled, true, "offline community background should cancel browser zoom");
  assert.equal(wheel.defaultPrevented, true, "offline community background should prevent browser default");

  const after = await waitForCommunityRegionGeometryChange(page, communityId, before);
  const afterMetrics = await browserPageMetrics(page);
  assert.deepEqual(afterMetrics, beforeMetrics, "offline community wheel should not change browser page metrics");

  const trustedPoint = await findCommunityRegionPoint(page, communityId);
  const beforeTrusted = await communityRegionGeometry(page, communityId);
  await page.mouse.move(trustedPoint.x, trustedPoint.y);
  await page.mouse.wheel(0, -48);
  const afterTrusted = await waitForCommunityRegionGeometryChange(page, communityId, beforeTrusted);
  const trustedMetrics = await browserPageMetrics(page);
  assert.deepEqual(trustedMetrics, beforeMetrics, "trusted offline community wheel should stay inside the graph");

  return {
    point,
    wheel,
    before,
    after,
    trustedPoint,
    beforeTrusted,
    afterTrusted,
    beforeMetrics,
    afterMetrics,
    trustedMetrics
  };
}

async function communityRegionGeometry(page, communityId) {
  return page.evaluate((communityId) => {
    const region = document.querySelector(`.sigma-global-community-region[data-community-id="${CSS.escape(communityId)}"]`);
    if (!(region instanceof Element)) throw new Error(`Missing Sigma community region ${communityId}`);
    const rect = region.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      diagonal: Math.hypot(rect.width, rect.height)
    };
  }, communityId);
}

async function waitForCommunityRegionGeometryChange(page, communityId, before) {
  await page.waitForFunction(({ communityId, diagonal }) => {
    const region = document.querySelector(`.sigma-global-community-region[data-community-id="${CSS.escape(communityId)}"]`);
    if (!(region instanceof Element)) return false;
    const rect = region.getBoundingClientRect();
    return Math.abs(Math.hypot(rect.width, rect.height) - diagonal) > Math.max(1, diagonal * 0.01);
  }, { communityId, diagonal: before.diagonal }, { timeout: 3000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return communityRegionGeometry(page, communityId);
}

async function browserPageMetrics(page) {
  return page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    visualViewportScale: window.visualViewport?.scale || 1,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  }));
}

async function communityLabelCenter(page, communityId) {
  return page.evaluate((communityId) => {
    const label = document.querySelector(`.sigma-global-community-label[data-community-id="${CSS.escape(communityId)}"]`);
    if (!label) throw new Error(`Missing Sigma community label ${communityId}`);
    const rect = label.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, communityId);
}

async function waitForCommunitySelection(page, communityId) {
  await page.waitForFunction((communityId) => (
    document.querySelector(`.sigma-global-community-region[data-community-id="${CSS.escape(communityId)}"]`)?.getAttribute("data-selected") === "true"
  ), communityId);
}

async function setSearchQuery(page, query) {
  await page.locator(".graph-search-input").focus();
  await page.evaluate((query) => {
    const input = document.querySelector(".graph-search[data-state='open'] .graph-search-input");
    if (!(input instanceof HTMLInputElement)) throw new Error("Graph search input is not open");
    input.value = query;
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: query
    }));
  }, query);
  await page.waitForFunction((query) => (
    document.querySelector(".graph-search-input")?.value === query
  ), query);
}
