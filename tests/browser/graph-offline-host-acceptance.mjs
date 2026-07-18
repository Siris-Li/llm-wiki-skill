import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { pngNonBackgroundPixelCount } from "./lib/png-pixels.mjs";

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
  await page.getByRole("button", { name: "关闭选区面板" }).click();

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
  const themeBefore = await graphTheme(page);
  await themeToggle.click();
  const themeAfter = await waitForThemeChange(page, themeBefore);
  assert.notEqual(themeAfter, themeBefore, `${label} should switch theme`);

  const fixed = await page.evaluate(() => window.__LLM_WIKI_GRAPH_ENGINE__.setNodeFixed("A", "fix"));
  assert.equal(fixed, true, `${label} should fix a node`);
  await page.waitForSelector('.sigma-global-node-hit-target[data-node-id="A"][data-pinned="true"]');
  await page.reload({ waitUntil: "load" });
  await waitForSigma(page);
  await page.waitForSelector('.sigma-global-node-hit-target[data-node-id="A"][data-pinned="true"]');
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
  const previousStyles = await root.evaluate((element) => {
    const overlay = element.querySelector(".sigma-global-overlay");
    const snapshot = {
      background: element.style.background,
      overlayVisibility: overlay?.style.visibility || "",
    };
    element.style.background = "rgb(1, 2, 3)";
    if (overlay) overlay.style.visibility = "hidden";
    return snapshot;
  });
  const screenshot = await root.screenshot({ type: "png" });
  await root.evaluate((element, previous) => {
    const overlay = element.querySelector(".sigma-global-overlay");
    element.style.background = previous.background;
    if (overlay) overlay.style.visibility = previous.overlayVisibility;
  }, previousStyles);
  const nonBackgroundPixels = pngNonBackgroundPixelCount(screenshot, [1, 2, 3]);
  assert.ok(nonBackgroundPixels > 20, `${label} should have nonblank Sigma canvas pixels, got ${nonBackgroundPixels}`);
}
