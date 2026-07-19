import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { sigmaCanvasNonBackgroundPixelCount } from "./lib/png-pixels.mjs";

const html = process.env.GRAPH_OFFLINE_ACCEPTANCE_HTML || "";
const executablePath = process.env.GRAPH_OFFLINE_ACCEPTANCE_CHROME_EXECUTABLE || undefined;
assert.ok(html, "GRAPH_OFFLINE_ACCEPTANCE_HTML must point at generated offline HTML");

const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  await runOfflineJourney({ width: 1440, height: 960 }, "desktop");
  await runOfflineJourney({ width: 390, height: 844 }, "mobile");
} finally {
  await browser.close();
}

async function runOfflineJourney(viewport, label) {
  const context = await browser.newContext({ viewport });
  await context.setOffline(true);
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
  await waitForSigma(page);
  await assertNonblankSigmaCanvas(page, `${label} global graph`);
  assert.equal(await page.locator("[data-llm-wiki-graph-root='true']").count(), 0, `${label} normal route should not use DOM/SVG`);

  await page.keyboard.press("/");
  const search = page.locator(".graph-search-input");
  await search.fill("节点A");
  await page.waitForSelector('.sigma-global-node-hit-target[data-node-id="A"][data-search-hit="true"]');
  await page.waitForFunction(() => document.querySelector(".graph-search-status")?.textContent?.includes("1 个结果"));
  await search.press("Escape");

  await openFilters(page);
  const entityFilter = page.locator('.graph-type-filter-option input[data-type="entity"]');
  const visibleBeforeFilter = await page.locator(".sigma-global-node-hit-target").count();
  await entityFilter.uncheck();
  await page.waitForFunction((before) => document.querySelectorAll(".sigma-global-node-hit-target").length < before, visibleBeforeFilter);
  await entityFilter.check();
  await page.waitForFunction((before) => document.querySelectorAll(".sigma-global-node-hit-target").length === before, visibleBeforeFilter);

  await page.locator('.community-legend-row[data-community-id="t1"]').click();
  await page.waitForSelector('.graph-selection-panel[data-state="open"]');
  await page.locator(".graph-selection-title", { hasText: "社区选区" }).waitFor();
  await page.getByRole("button", { name: "进入社区" }).click();
  await page.waitForSelector('.sigma-global-renderer[data-community-focus-id="t1"]');
  await page.waitForSelector('.graph-selection-panel[data-state="closed"]');
  assert.equal(await page.locator('.sigma-global-route[data-route="sigma-global"]').count(), 1, `${label} community reading should stay on Sigma`);

  await page.locator('.sigma-global-node-hit-target[data-node-id="A"]').click();
  await page.waitForSelector('.graph-reader[data-state="open"]');
  await page.locator(".graph-reader-title", { hasText: "节点A" }).waitFor();
  await page.locator(".graph-reader-body", { hasText: "这是节点A的内容" }).waitFor();
  await page.getByRole("button", { name: "关闭阅读面板" }).click();

  await page.locator('.sigma-global-node-hit-target[data-node-id="A"]').click({ modifiers: ["Shift"] });
  await page.locator('.sigma-global-node-hit-target[data-node-id="B"]').click({ modifiers: ["Shift"] });
  await page.waitForSelector('.graph-selection-panel[data-state="open"]');
  assert.equal(await page.locator('.sigma-global-node-hit-target[data-selected="true"]').count(), 2, `${label} should support multi-selection`);
  await page.getByRole("button", { name: "关闭选区面板" }).click();

  const themeToggle = page.locator("[data-testid='offline-theme-toggle']");
  const themeKey = await page.evaluate(() => window.__LLM_WIKI_GRAPH_THEME_KEY__ || "");
  assert.notEqual(themeKey, "", `${label} should expose its compatible theme storage key`);
  const initialTheme = await graphTheme(page);
  const themeBefore = initialTheme === "shan-shui" ? "mo-ye" : "shan-shui";
  await page.evaluate(({ key, theme }) => window.localStorage.setItem(key, theme), { key: themeKey, theme: themeBefore });
  await page.reload({ waitUntil: "load" });
  await waitForSigma(page);
  assert.equal(await graphTheme(page), themeBefore, `${label} should read an existing theme record on startup`);
  await themeToggle.click();
  const themeAfter = await waitForThemeChange(page, themeBefore);
  assert.notEqual(themeAfter, themeBefore, `${label} should switch theme`);

  const drag = await dragVisibleNodeToPin(page);
  assert.ok(drag.distance > 10, `${label} drag should visibly move the pinned node: ${JSON.stringify(drag)}`);
  await page.waitForSelector(`.sigma-global-node-hit-target[data-node-id="${drag.nodeId}"][data-pinned="true"]`);
  await page.reload({ waitUntil: "load" });
  await waitForSigma(page);
  await page.waitForSelector(`.sigma-global-node-hit-target[data-node-id="${drag.nodeId}"][data-pinned="true"]`);
  assert.equal(await graphTheme(page), themeAfter, `${label} should restore the theme after refresh`);
  await assertNonblankSigmaCanvas(page, `${label} refreshed graph`);

  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    errorCount: document.querySelectorAll(".offline-error").length,
  }));
  assert.ok(overflow.width <= overflow.viewport + 1, `${label} should not overflow horizontally: ${JSON.stringify(overflow)}`);
  assert.equal(overflow.errorCount, 0, `${label} successful journey should not show an error`);
  assert.equal(pageErrors.length, 0, `${label} should not leak browser exceptions: ${pageErrors.map(String).join("; ")}`);
  await context.close();
}

async function waitForSigma(page) {
  await page.waitForSelector('.sigma-global-route[data-route="sigma-global"]');
  await page.waitForSelector('.sigma-global-renderer[data-renderer="sigma-global"]');
  await page.waitForSelector(".sigma-global-node-hit-target");
}

async function openFilters(page) {
  const toolbar = page.locator(".graph-toolbar");
  if (await toolbar.getAttribute("data-panel") !== "filters") {
    await page.getByRole("button", { name: "筛选" }).click();
  }
  await page.waitForSelector('.graph-toolbar[data-panel="filters"]');
}

async function graphTheme(page) {
  return page.locator(".llm-wiki-graph-engine").getAttribute("data-theme");
}

async function waitForThemeChange(page, previous) {
  await page.waitForFunction((previous) => document.querySelector(".llm-wiki-graph-engine")?.getAttribute("data-theme") !== previous, previous);
  return graphTheme(page);
}

async function dragVisibleNodeToPin(page) {
  const { nodeId, point: start } = await stableVisibleNodeDragTarget(page);
  const target = page.locator(`.sigma-global-node-hit-target[data-node-id="${nodeId}"]`);
  await target.waitFor();
  const before = await target.boundingBox();
  assert.ok(before, `offline drag needs a visible node target for ${nodeId}`);
  const beforeCenter = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const viewport = page.viewportSize();
  assert.ok(viewport, "offline drag needs a fixed browser viewport");
  const dx = start.x < viewport.width / 2 ? 48 : -48;
  const dy = start.y < viewport.height / 2 ? 30 : -30;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx / 2, start.y + dy / 2, { steps: 6 });
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector(`.sigma-global-node-hit-target[data-node-id="${nodeId}"][data-pinned="true"]`);
  const after = await target.boundingBox();
  assert.ok(after, `offline dragged node ${nodeId} should remain visible`);
  const end = { x: after.x + after.width / 2, y: after.y + after.height / 2 };
  return { nodeId, start, before: beforeCenter, end, distance: Math.hypot(end.x - beforeCenter.x, end.y - beforeCenter.y) };
}

async function stableVisibleNodeDragTarget(page) {
  return page.locator(".sigma-global-renderer").evaluate(async (renderer) => {
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      const target = firstHitTarget(renderer);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nextTarget = firstHitTarget(renderer);
      if (
        target &&
        nextTarget &&
        target.nodeId === nextTarget.nodeId &&
        Math.abs(target.point.x - nextTarget.point.x) < 1 &&
        Math.abs(target.point.y - nextTarget.point.y) < 1
      ) return nextTarget;
    }
    throw new Error("No stable browser hit point for an offline node");

    function firstHitTarget(root) {
      for (const node of root.querySelectorAll(".sigma-global-node-hit-target")) {
        const nodeId = node.getAttribute("data-node-id") || "";
        const point = hitPoint(node, nodeId);
        if (point) return { nodeId, point };
      }
      return null;
    }

    function hitPoint(node, id) {
      const rect = node.getBoundingClientRect();
      for (const point of nodeHitCandidates(rect)) {
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit?.closest?.(".sigma-global-node-hit-target")?.getAttribute("data-node-id") === id) return point;
      }
      return null;
    }

    function nodeHitCandidates(rect) {
      const points = [{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }];
      for (const xRatio of [0.2, 0.35, 0.65, 0.8]) {
        for (const yRatio of [0.2, 0.35, 0.5, 0.65, 0.8]) {
          points.push({ x: rect.left + rect.width * xRatio, y: rect.top + rect.height * yRatio });
        }
      }
      return points;
    }
  });
}

async function assertNonblankSigmaCanvas(page, label) {
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 6;
    const tick = () => {
      frames -= 1;
      if (frames <= 0) resolve(undefined);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const root = page.locator('.sigma-global-renderer[data-renderer="sigma-global"]');
  const signal = await root.evaluate((element) => ({ canvasCount: element.querySelectorAll("canvas").length }));
  assert.ok(signal.canvasCount > 0, `${label} should have Sigma canvases`);
  const nonBackgroundPixels = await sigmaCanvasNonBackgroundPixelCount(root);
  assert.ok(nonBackgroundPixels > 20, `${label} should have nonblank Sigma canvas pixels, got ${nonBackgroundPixels}`);
}
