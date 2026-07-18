import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_ORIENTAL_CONTRACT_HTML || "";
assert.notEqual(html, "", "GRAPH_ORIENTAL_CONTRACT_HTML must point at generated HTML");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto(pathToFileURL(html).href, { waitUntil: "load" });

  const title = page.locator(".offline-title h1");
  await title.waitFor();
  assert.match(await title.innerText(), /HTML测试知识库.*知识舆图/, "first view should identify the real knowledge map");
  const graph = page.locator('[data-testid="offline-graph-root"]');
  await graph.locator('.sigma-global-renderer[data-renderer="sigma-global"]').waitFor();
  assert.ok(await graph.locator("canvas").count() > 0, "first view should contain the real Sigma graph");
  assert.equal(await page.locator(".offline-error").count(), 0, "first view should not show recovery UI");

  const recommendedStart = page.locator('.sigma-global-node-hit-target[data-node-id="A"][data-start-node="true"]');
  await recommendedStart.waitFor();
  const startBox = await recommendedStart.boundingBox();
  assert.ok(startBox, "recommended start should be visible in the graph");
  assert.ok(
    startBox.x < 1440 && startBox.y < 960 && startBox.x + startBox.width > 0 && startBox.y + startBox.height > 0,
    `recommended start should intersect the first viewport: ${JSON.stringify(startBox)}`
  );

  await recommendedStart.click();
  const reader = page.locator('.graph-reader[data-state="open"]');
  await reader.waitFor();
  await reader.locator(".graph-reader-title", { hasText: "节点A" }).waitFor();
  await reader.locator(".graph-reader-body", { hasText: "这是节点A的内容" }).waitFor();
  assert.equal(pageErrors.length, 0, `browser journey should not leak exceptions: ${pageErrors.map(String).join("; ")}`);
} finally {
  await browser.close();
}
