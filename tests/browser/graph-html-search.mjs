import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_HTML_SEARCH_HTML || "";
assert.notEqual(html, "", "GRAPH_HTML_SEARCH_HTML must point at generated HTML");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(pathToFileURL(html).href);
  try {
    await page.waitForSelector(".sigma-global-renderer, [data-llm-wiki-graph-root='true']");
  } catch (error) {
    throw new Error(`offline graph did not mount:\n${pageErrors.join("\n")}`, { cause: error });
  }

  const input = page.locator(".graph-search-input");
  await input.fill("  节点A  ");
  const results = page.locator(".graph-search-result-item");
  await page.waitForFunction(() => document.querySelector(".graph-search-status")?.textContent === "1 个结果");
  const resultCount = await results.count();
  if (resultCount) {
    assert.equal(resultCount, 1, "the visible result list should contain only the matching node");
    assert.equal(await results.first().locator(".graph-search-result-label").innerText(), "节点A");
  } else {
    assert.equal(await page.locator('.node[data-id="A"]').getAttribute("data-search-state"), "match");
    assert.equal(await page.locator('.node[data-id="B"]').getAttribute("data-search-state"), "faded");
  }
  assert.equal(await page.locator(".graph-search-status").innerText(), "1 个结果");

  await input.press("ArrowDown");
  assert.match(await page.locator(".graph-search-status").innerText(), /1\/1$/);
  if (resultCount) {
    assert.equal(await results.first().getAttribute("aria-selected"), "true");
  } else {
    assert.equal(await page.locator('.node[data-id="A"]').getAttribute("data-search-focus"), "true");
  }

  await input.press("Enter");
  await page.waitForFunction(() => (
    document.querySelector('.sigma-global-node-hit-target[data-node-id="A"]')?.dataset.selected === "true"
    || document.querySelector('.node[data-id="A"]')?.getAttribute("aria-pressed") === "true"
  ));

  await input.fill("不存在的节点");
  await page.waitForFunction(() => document.querySelector(".graph-search-status")?.textContent === "0 个结果");
  assert.equal(await results.count(), 0, "the visible result list should be empty for a missing node");
} finally {
  await browser.close();
}
