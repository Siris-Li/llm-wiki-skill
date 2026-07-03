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

const T1_NODE_IDS = ["A", "B", "C", "D", "E", "F"];

const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  const desktop = await runFlow({ width: 1440, height: 900 }, "desktop", { testDrag: true });
  const mobile = await runFlow({ width: 390, height: 844 }, "mobile", { testDrag: false });
  const evidence = { desktop, mobile };
  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, "community-phase2-local-map.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await closeBrowserForRegression(browser);
}

async function runFlow(viewport, label, { testDrag }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.localStorage.setItem("llm-wiki-agent-main-view", "graph");
    window.localStorage.setItem("llm-wiki-agent-theme", "light");
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

  // 2. Enter community -> DOM local map.
  await page.locator('[data-testid="graph-community-summary"] button', { hasText: "进入社区" }).click();
  await waitForDomCommunity(page, "t1");

  const localMap = await communitySnapshot(page);
  assert.equal(localMap.focus, "community:t1");
  assert.equal(localMap.communityMapState, "lightweight");
  assert.equal(localMap.communityMapMotion, "frozen", "community reading should freeze automatic motion");
  assert.equal(localMap.communityMapCommunityId, "t1");
  assert.equal(localMap.communityMapSourceCommunityId, "t1", "source community context should be exposed on the DOM root");
  assert.ok(localMap.communityMapBounds && localMap.communityMapBounds.width > 0, "local-map bounds should be stable");
  assert.ok(localMap.visibleLabelCount > 0, "community map should show key labels");
  assert.ok(localMap.visibleLabelCount <= localMap.labelLimit, "visible labels should stay inside the label budget");
  assert.ok(localMap.skeletonEdges >= 1, "community map should keep a skeleton edge layer");
  assert.equal(localMap.nodeTiers.A, "core", "recommended start node should be a core local-map node");
  assert.ok(
    Object.values(localMap.nodeTiers).some((tier) => tier === "peripheral"),
    "source community context must not promote every node to core (a dense community keeps peripheral nodes)"
  );
  assert.equal(localMap.edgeLayers.eAB, "skeleton", "A-B should be part of the skeleton edge layer");

  // 3. No post-entry shape drift (world coordinates stay fixed; camera may still move).
  await page.waitForTimeout(700);
  const afterSettle = await communitySnapshot(page);
  assertMaxDrift(localMap.nodeWorldPoints, afterSettle.nodeWorldPoints, 0.5);

  // 4. Manual drag still works while automatic motion is frozen (desktop pointer flow).
  if (testDrag) {
    await dragCommunityNode(page, "B", { x: 40, y: 28 });
    const afterDrag = await communitySnapshot(page);
    assertPointShifted(afterDrag.nodeCenters.B, afterSettle.nodeCenters.B, "manual drag should still move a node while automatic motion is frozen");
  }

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, `community-phase2-${label}-community.png`), fullPage: true });
  }

  // 5. Return to global keeps the source community highlighted.
  // Desktop-only: on narrow mobile viewports the community reading drawer overlays
  // the toolbar/map, so the return + highlight interaction is verified on desktop
  // and by graph-engine facade unit tests. Mobile still captures the local-map
  // screenshot above for visual review (spec 9.2).
  let returned = null;
  if (testDrag) {
    await clickReturnGlobal(page);
    await waitForSigmaGlobal(page);
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".sigma-global-community-region[data-selected='true']"))
        .some((region) => region.getAttribute("data-community-id") === "t1"),
      undefined,
      { timeout: 5000 }
    ).catch(() => undefined);
    returned = await sigmaSnapshot(page);
    assert.deepEqual(returned.selectedRegions, ["t1"], "returning global should keep the source community highlighted");
    if (artifactDir) {
      await page.screenshot({ path: path.join(artifactDir, `community-phase2-${label}-returned-global.png`), fullPage: true });
    }
  }

  await page.close();
  return { viewport: `${viewport.width}x${viewport.height}`, selectedBeforeEnter, localMap, returned };
}

async function waitForSigmaGlobal(page) {
  await page.waitForSelector(".sigma-global-route[data-route='sigma-global']");
  await page.waitForSelector(".sigma-global-renderer[data-renderer='sigma-global']");
  await page.waitForSelector(".sigma-global-community-region");
}

async function waitForDomCommunity(page, communityId) {
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForFunction((communityId) => {
    return document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus === `community:${communityId}`
      && document.querySelectorAll(".node").length > 0
      && !document.querySelector(".sigma-global-renderer");
  }, communityId);
  await page.waitForSelector("[data-llm-wiki-graph-root='true'][data-community-map-state='lightweight']");
  await page.waitForSelector(".node[data-id='A']");
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
    domNodeCount: document.querySelectorAll(".node").length
  }));
}

async function communitySnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const nodes = Array.from(document.querySelectorAll(".node"));
    const edges = Array.from(document.querySelectorAll(".edge"));
    return {
      focus: document.querySelector(".graph-host")?.dataset.llmWikiGraphFocus || "",
      communityMapState: root?.getAttribute("data-community-map-state") || "",
      communityMapMotion: root?.getAttribute("data-community-map-motion") || "",
      communityMapSourceCommunityId: root?.getAttribute("data-community-map-source-community-id") || "",
      communityMapCommunityId: root?.getAttribute("data-community-map-community-id") || "",
      communityMapBounds: JSON.parse(root?.getAttribute("data-community-map-bounds") || "null"),
      labelLimit: Number(root?.getAttribute("data-community-map-label-limit") || "0"),
      visibleLabelCount: Array.from(document.querySelectorAll(".node-name")).filter((element) => getComputedStyle(element).display !== "none").length,
      skeletonEdges: Number(root?.getAttribute("data-community-map-skeleton-edges") || "0"),
      nodeTiers: Object.fromEntries(nodes.map((node) => [
        node.getAttribute("data-id") || "",
        node.getAttribute("data-community-map-tier") || ""
      ])),
      edgeLayers: Object.fromEntries(edges.map((edge) => [
        edge.getAttribute("data-edge-id") || "",
        edge.getAttribute("data-community-map-layer") || ""
      ])),
      nodeCenters: Object.fromEntries(nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return [
          node.getAttribute("data-id") || "",
          {
            x: Math.round((rect.left + rect.width / 2) * 100) / 100,
            y: Math.round((rect.top + rect.height / 2) * 100) / 100
          }
        ];
      })),
      nodeWorldPoints: Object.fromEntries(nodes.map((node) => [
        node.getAttribute("data-id") || "",
        {
          x: Number(node.getAttribute("data-world-x") || "0"),
          y: Number(node.getAttribute("data-world-y") || "0")
        }
      ]))
    };
  });
}

async function dragCommunityNode(page, nodeId, delta) {
  const locator = page.locator(`.node[data-id="${cssString(nodeId)}"]`).first();
  const box = await locator.boundingBox();
  assert.ok(box, `node ${nodeId} should have a box before drag`);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x / 2, start.y + delta.y / 2, { steps: 6 });
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((id) => document.querySelector(`.node[data-id="${id}"]`)?.classList.contains("is-pinned"), nodeId, { timeout: 5000 });
}

async function clickReturnGlobal(page) {
  // Force past the community reading drawer, which can overlay the toolbar on
  // narrow viewports. Closing the drawer would clear the source context, so we
  // click through instead of dismissing it.
  await page.getByRole("button", { name: "回全图" }).click({ force: true });
}

async function closeDrawerIfOpen(page) {
  const button = page.locator(".drawer-header button[aria-label='关闭']");
  if (await button.count()) {
    await button.first().click({ force: true });
    await page.waitForSelector(".drawer-panel-open", { state: "detached", timeout: 3000 }).catch(() => undefined);
  }
}

function assertMaxDrift(beforeCenters, afterCenters, maxDrift) {
  for (const [nodeId, before] of Object.entries(beforeCenters)) {
    const after = afterCenters[nodeId];
    if (!after) continue;
    assert.ok(Math.abs(before.x - after.x) <= maxDrift, `${nodeId} world x drift should stay within ${maxDrift}`);
    assert.ok(Math.abs(before.y - after.y) <= maxDrift, `${nodeId} world y drift should stay within ${maxDrift}`);
  }
}

function assertPointShifted(after, before, message) {
  assert.ok(after && before, message);
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  assert.ok(distance > 4, `${message}; expected visible movement, got ${distance}px`);
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

function cssString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
