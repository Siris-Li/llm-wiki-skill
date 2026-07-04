import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const workbenchUrl = process.env.GRAPH_COMMUNITY_PHASE2_URL || "";
const artifactDir = process.env.GRAPH_COMMUNITY_PHASE2_ARTIFACT_DIR || "";
const executablePath = process.env.GRAPH_COMMUNITY_PHASE2_CHROME_EXECUTABLE || "";

assert.notEqual(workbenchUrl, "", "GRAPH_COMMUNITY_PHASE2_URL must point at the workbench dev server");

const T1_NODE_COUNT = 16;
const T1_INTERNAL_EDGE_COUNT = 15;

const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  // Mobile runs first so the desktop drag/pin path cannot contaminate the
  // narrow-viewport baseline in the shared temporary knowledge base.
  const mobile = await runFlow({ width: 390, height: 844 }, "mobile");
  const desktop = await runFlow({ width: 1440, height: 900 }, "desktop");
  const evidence = { desktop, mobile };
  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, "community-phase2-local-map.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await closeBrowserForRegression(browser);
}

async function runFlow(viewport, label) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.localStorage.setItem("llm-wiki-agent-main-view", "graph");
    window.localStorage.setItem("llm-wiki-agent-theme", "light");
    window.localStorage.setItem("llm-wiki-agent-drawer-width", "320");
    window.localStorage.setItem("llm-wiki-agent-sidebar-collapsed", "true");
  });
  await page.goto(workbenchUrl);
  await page.waitForSelector(".app-shell");
  const kbButton = page.getByRole("button", { name: /Phase 2 Local Map Test|phase-2-local-map/ });
  if (await kbButton.count() && await kbButton.first().isVisible()) await kbButton.first().click();
  const graphButton = page.getByRole("button", { name: /图谱/ });
  if (await graphButton.count() && await graphButton.first().isVisible() && await graphButton.first().isEnabled()) {
    await graphButton.first().click();
  }
  await page.waitForSelector(".graph-host");
  await waitForSigmaGlobal(page);

  // 1. Global Sigma selects the source community before entering.
  const selectedBeforeEnter = await openCommunitySummaryFromRegion(page, "t1");
  assert.deepEqual(selectedBeforeEnter.selectedRegions, ["t1"], "global Sigma should select the source community before enter");

  // 2. Enter community -> Sigma focused community reading, not DOM.
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForSigmaCommunity(page, "t1");
  await page.waitForSelector('[data-testid="graph-community-summary"]', { state: "detached", timeout: 5000 });

  const localMap = await communitySnapshot(page);
  assert.equal(localMap.route, "sigma-global", "community reading should stay on the Sigma route");
  assert.equal(localMap.sigmaRendererCount, 1, "community reading should keep a Sigma renderer mounted");
  assert.equal(localMap.domRootCount, 0, "DOM/SVG community view should not be the primary route");
  assert.equal(localMap.communityFocusId, "t1");
  assert.equal(localMap.sourceCommunityId, "t1");
  assert.equal(localMap.nodeCount, T1_NODE_COUNT, "Sigma community reading should keep only current-community nodes");
  assert.equal(localMap.edgeCount, T1_INTERNAL_EDGE_COUNT, "Sigma community reading should keep only internal community relationships");
  assert.deepEqual(localMap.communityRegionIds, ["t1"], "only the focused community region should remain visible");
  assert.deepEqual(localMap.communityLabelIds, ["t1"], "only the focused community label should remain visible");

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, `community-phase2-${label}-community.png`), fullPage: true });
  }

  // 5. Return to global keeps the source community highlighted until a real
  // clear/replace action removes it.
  await clickReturnGlobal(page);
  await waitForSigmaGlobalUnfocused(page);
  await waitForSelectedCommunity(page, "t1");
  const returned = await sigmaSnapshot(page);
  assert.equal(returned.nodeCount, 18, "returning global should restore all nodes");
  assert.equal(returned.edgeCount, 17, "returning global should restore all relationships");
  assert.equal(returned.communityCount, 2, "returning global should restore all communities");
  assert.equal(returned.communityFocusId, "");
  assert.equal(returned.sourceCommunityId, "t1");
  assert.equal(returned.communitySummaryOpen, false, "returning global should not reopen the community summary drawer");
  assert.deepEqual(returned.selectedRegions, ["t1"], "returning global should keep the source community region highlighted");
  assert.deepEqual(returned.selectedLabels, ["t1"], "returning global should keep the source community label highlighted");
  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, `community-phase2-${label}-returned-global.png`), fullPage: true });
  }

  await clickGlobalBlank(page);
  await waitForNoSelectedCommunity(page);
  const afterBlankClear = await sigmaSnapshot(page);
  assert.equal(afterBlankClear.sourceCommunityId, "", "blank clear should remove the source community context");
  assert.deepEqual(afterBlankClear.selectedRegions, [], "blank clear should remove the returned source community region highlight");
  assert.deepEqual(afterBlankClear.selectedLabels, [], "blank clear should remove the returned source community label highlight");

  await clickCommunityRegion(page, "t2");
  await waitForSelectedCommunity(page, "t2");
  const afterReplace = await sigmaSnapshot(page);
  assert.deepEqual(afterReplace.selectedRegions, ["t2"], "selecting another community should replace the old source community region highlight");
  assert.deepEqual(afterReplace.selectedLabels, ["t2"], "selecting another community should replace the old source community label highlight");

  await page.close();
  return { viewport: `${viewport.width}x${viewport.height}`, selectedBeforeEnter, localMap, returned, afterBlankClear, afterReplace };
}

async function waitForSigmaGlobal(page) {
  await page.waitForSelector(".sigma-global-route[data-route='sigma-global']");
  await page.waitForSelector(".sigma-global-renderer[data-renderer='sigma-global']");
  await page.waitForSelector(".sigma-global-community-region");
}

async function waitForSigmaCommunity(page, communityId) {
  await waitForSigmaGlobal(page);
  await page.waitForFunction((communityId) => {
    const root = document.querySelector(".sigma-global-renderer[data-renderer='sigma-global']");
    return root?.getAttribute("data-community-focus-id") === communityId
      && root?.getAttribute("data-source-community-id") === communityId
      && document.querySelectorAll("[data-llm-wiki-graph-root='true']").length === 0;
  }, communityId);
}

async function waitForSigmaGlobalUnfocused(page) {
  await waitForSigmaGlobal(page);
  await page.waitForFunction(() => {
    const root = document.querySelector(".sigma-global-renderer[data-renderer='sigma-global']");
    return root?.getAttribute("data-community-focus-id") === ""
      && Number(root?.getAttribute("data-community-count") || "0") > 1;
  });
}

async function openCommunitySummaryFromRegion(page, communityId) {
  await closeDrawerIfOpen(page);
  await clickCommunityRegion(page, communityId);
  await page.waitForSelector('[data-testid="graph-community-summary"]');
  return sigmaSnapshot(page);
}

async function clickCommunityRegion(page, communityId) {
  const point = await findCommunityRegionPoint(page, communityId);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function clickGlobalBlank(page) {
  const point = await graphBlankPoint(page);
  await page.mouse.click(point.x, point.y);
}

async function graphBlankPoint(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".sigma-global-route") || document.querySelector(".graph-host");
    if (!host) throw new Error("Missing Sigma global route for blank click");
    const rect = host.getBoundingClientRect();
    const candidates = [
      [0.08, 0.12],
      [0.92, 0.12],
      [0.08, 0.88],
      [0.92, 0.88],
      [0.5, 0.08],
      [0.5, 0.92]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      const hit = document.elementFromPoint(x, y);
      if (!hit?.closest?.(".drawer-panel-open, .drawer-panel, .sigma-global-community-region, .sigma-global-node-hit-target, .sigma-global-community-label, .sigma-global-aggregation-container")) {
        return { x, y };
      }
    }
    return { x: rect.left + 12, y: rect.top + 12 };
  });
}

async function findCommunityRegionPoint(page, communityId) {
  return page.evaluate((communityId) => {
    const region = document.querySelector(`.sigma-global-community-region[data-community-id="${CSS.escape(communityId)}"]`)
      || document.querySelector(".sigma-global-community-region");
    if (!region) throw new Error(`Missing Sigma community region ${communityId}`);
    const rect = region.getBoundingClientRect();
    const candidates = [
      [0.5, 0.5],
      [0.5, 0.32],
      [0.32, 0.5],
      [0.68, 0.5],
      [0.5, 0.68]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      const hit = document.elementFromPoint(x, y);
      const hitRegionId = hit?.closest?.(".sigma-global-community-region")?.getAttribute("data-community-id") || "";
      if (hitRegionId === communityId && !hit?.closest?.(".sigma-global-node-hit-target")) return { x, y };
    }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, communityId);
}

async function sigmaSnapshot(page) {
  return page.evaluate(() => ({
    selectedRegions: Array.from(document.querySelectorAll(".sigma-global-community-region[data-selected='true']"))
      .map((region) => region.getAttribute("data-community-id") || "")
      .filter(Boolean)
      .sort(),
    selectedLabels: Array.from(document.querySelectorAll(".sigma-global-community-label[data-selected='true']"))
      .map((label) => label.getAttribute("data-community-id") || "")
      .filter(Boolean)
      .sort(),
    sigmaRendererCount: document.querySelectorAll(".sigma-global-renderer[data-renderer='sigma-global']").length,
    domNodeCount: document.querySelectorAll(".node").length,
    nodeCount: Number(document.querySelector(".sigma-global-renderer")?.getAttribute("data-node-count") || "0"),
    edgeCount: Number(document.querySelector(".sigma-global-renderer")?.getAttribute("data-edge-count") || "0"),
    communityCount: Number(document.querySelector(".sigma-global-renderer")?.getAttribute("data-community-count") || "0"),
    communityFocusId: document.querySelector(".sigma-global-renderer")?.getAttribute("data-community-focus-id") || "",
    sourceCommunityId: document.querySelector(".sigma-global-renderer")?.getAttribute("data-source-community-id") || "",
    communitySummaryOpen: Boolean(document.querySelector('[data-testid="graph-community-summary"]'))
  }));
}

async function waitForSelectedCommunity(page, communityId) {
  await page.waitForFunction((communityId) => {
    const selectedRegions = Array.from(document.querySelectorAll(".sigma-global-community-region[data-selected='true']"))
      .map((region) => region.getAttribute("data-community-id") || "")
      .filter(Boolean)
      .sort();
    const selectedLabels = Array.from(document.querySelectorAll(".sigma-global-community-label[data-selected='true']"))
      .map((label) => label.getAttribute("data-community-id") || "")
      .filter(Boolean)
      .sort();
    return selectedRegions.length === 1
      && selectedRegions[0] === communityId
      && selectedLabels.length === 1
      && selectedLabels[0] === communityId;
  }, communityId, { timeout: 5000 });
}

async function waitForNoSelectedCommunity(page) {
  await page.waitForFunction(() => {
    return document.querySelectorAll(".sigma-global-community-region[data-selected='true']").length === 0
      && document.querySelectorAll(".sigma-global-community-label[data-selected='true']").length === 0;
  }, undefined, { timeout: 5000 });
}

async function communitySnapshot(page) {
  return page.evaluate(() => ({
    route: document.querySelector(".graph-host")?.getAttribute("data-llm-wiki-graph-route") || "",
    sigmaRendererCount: document.querySelectorAll(".sigma-global-renderer[data-renderer='sigma-global']").length,
    domRootCount: document.querySelectorAll("[data-llm-wiki-graph-root='true']").length,
    nodeCount: Number(document.querySelector(".sigma-global-renderer")?.getAttribute("data-node-count") || "0"),
    edgeCount: Number(document.querySelector(".sigma-global-renderer")?.getAttribute("data-edge-count") || "0"),
    communityCount: Number(document.querySelector(".sigma-global-renderer")?.getAttribute("data-community-count") || "0"),
    communityFocusId: document.querySelector(".sigma-global-renderer")?.getAttribute("data-community-focus-id") || "",
    sourceCommunityId: document.querySelector(".sigma-global-renderer")?.getAttribute("data-source-community-id") || "",
    communityRegionIds: Array.from(document.querySelectorAll(".sigma-global-community-region"))
      .map((region) => region.getAttribute("data-community-id") || "")
      .filter(Boolean)
      .sort(),
    communityLabelIds: Array.from(document.querySelectorAll(".sigma-global-community-label"))
      .map((label) => label.getAttribute("data-community-id") || "")
      .filter(Boolean)
      .sort()
  }));
}

async function clickReturnGlobal(page) {
  // Try the toolbar first. On narrow viewports the drawer can cover it, so fall
  // back to the graph's blank double-click return gesture without closing the
  // drawer (closing would clear the source context before we can assert it).
  await page.getByRole("button", { name: "回全图" }).click({ force: true }).catch(() => undefined);
  const returned = await page.waitForFunction(() => {
    const root = document.querySelector(".sigma-global-renderer[data-renderer='sigma-global']");
    return root?.getAttribute("data-community-focus-id") === ""
      && Number(root?.getAttribute("data-community-count") || "0") > 1;
  }, undefined, { timeout: 1200 })
    .then(() => true)
    .catch(() => false);
  if (returned) return;
  await dispatchGraphBlankDoubleClick(page);
}

async function dispatchGraphBlankDoubleClick(page) {
  const rootFound = await page.evaluate(() => {
    const root = document.querySelector(".sigma-global-renderer") || document.querySelector("[data-llm-wiki-graph-root='true']");
    if (!root) return false;
    const rect = root.getBoundingClientRect();
    const x = rect.left + Math.max(12, Math.min(32, rect.width * 0.08));
    const y = rect.top + Math.max(12, Math.min(32, rect.height * 0.08));
    root.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      detail: 2,
      view: window
    }));
    return true;
  });
  assert.equal(rootFound, true, "graph blank double-click fallback should dispatch to the graph root");
}

async function closeDrawerIfOpen(page) {
  const button = page.locator(".drawer-header button[aria-label='关闭']");
  if (await button.count()) {
    await button.first().click({ force: true });
    await page.waitForSelector(".drawer-panel-open", { state: "detached", timeout: 3000 }).catch(() => undefined);
  }
}

async function closeBrowserForRegression(browser) {
  let closed = false;
  const closePromise = browser.close()
    .then(() => {
      closed = true;
    })
    .catch(() => {
      closed = true;
    });
  await Promise.race([
    closePromise,
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  const browserProcess = typeof browser.process === "function" ? browser.process() : null;
  if (!closed) browserProcess?.kill("SIGKILL");
}
