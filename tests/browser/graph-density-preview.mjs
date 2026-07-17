import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_DENSITY_PREVIEW_HTML || "";
assert.notEqual(html, "", "GRAPH_DENSITY_PREVIEW_HTML must point at generated HTML");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-testid='offline-graph-root'][data-llm-wiki-graph-engine='mounted']");

  const root = page.locator("[data-testid='offline-graph-root']");
  assert.equal(await root.getAttribute("data-llm-wiki-graph-route"), "sigma-global");

  const renderer = page.locator(".sigma-global-renderer");
  assert.equal(await renderer.getAttribute("data-node-count"), "240", "the user-visible canvas should receive every fixture node");
  assert.equal(await renderer.getAttribute("data-edge-count"), "239", "the user-visible canvas should receive every fixture edge");

  const visibleHitTargets = page.locator(".sigma-global-node-hit-target");
  await visibleHitTargets.first().waitFor();
  const labeledCount = await page.locator(".sigma-global-node-hit-target[data-label-visible='true']").count();
  const pointCount = await page.locator(".sigma-global-node-hit-target[data-label-visible='false']").count();
  assert.ok(pointCount > labeledCount * 2, `dense view should show mostly quiet points, got ${pointCount} points and ${labeledCount} labels`);
  assert.ok(labeledCount > 0 && labeledCount <= 40, `dense view should retain a sparse readable label set, got ${labeledCount}`);

  const nodeCanvas = page.locator("canvas.sigma-nodes");
  await nodeCanvas.waitFor();
  const canvasBox = await nodeCanvas.boundingBox();
  assert.ok(canvasBox && canvasBox.width > 1000 && canvasBox.height > 600, "the dense graph should paint into the visible canvas");

  const labeled = page.locator(".sigma-global-node-hit-target[data-label-visible='true']").first();
  const point = page.locator(".sigma-global-node-hit-target[data-label-visible='false']").first();
  const labeledBox = await labeled.boundingBox();
  const pointBox = await point.boundingBox();
  assert.ok(labeledBox && pointBox && labeledBox.width > pointBox.width, "readable landmarks should remain larger than quiet points");
  assert.equal(await point.getAttribute("type"), "button", "quiet points should retain a direct interaction target");
} finally {
  await browser.close();
}
