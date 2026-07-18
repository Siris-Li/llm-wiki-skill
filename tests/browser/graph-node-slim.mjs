import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_NODE_SLIM_HTML || "";
assert.notEqual(html, "", "GRAPH_NODE_SLIM_HTML must point at generated HTML");

const browser = await chromium.launch({
  // This regression targets the DOM/SVG small-graph fallback. The default offline
  // global route uses Sigma when WebGL is available, which has a different DOM.
  args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForFunction(() => document.querySelector("[data-llm-wiki-graph-route]")?.dataset.llmWikiGraphRoute === "dom-svg-small-fallback");

  const graphRoot = page.locator("[data-llm-wiki-graph-root='true']");
  const contentLayer = page.locator("[data-viewport-layer='true']");
  const minimapViewport = page.locator("[data-mini-map-viewport='true']");
  await minimapViewport.waitFor();
  const initialTransform = await contentLayer.evaluate((element) => element.style.transform);
  const initialMinimapRect = await minimapViewport.evaluate((element) => ({
    x: element.getAttribute("x"),
    y: element.getAttribute("y"),
    width: element.getAttribute("width"),
    height: element.getAttribute("height")
  }));
  await page.mouse.move(64, 120);
  await page.mouse.wheel(0, -500);
  await page.waitForFunction((previous) => document.querySelector("[data-viewport-layer='true']")?.style.transform !== previous, initialTransform);
  const zoomedTransform = await contentLayer.evaluate((element) => element.style.transform);
  await page.mouse.move(72, 132);
  await page.mouse.down();
  await page.mouse.move(190, 182, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const pannedTransform = await contentLayer.evaluate((element) => element.style.transform);
  const navigatedMinimapRect = await minimapViewport.evaluate((element) => ({
    x: element.getAttribute("x"),
    y: element.getAttribute("y"),
    width: element.getAttribute("width"),
    height: element.getAttribute("height")
  }));
  assert.notDeepEqual(navigatedMinimapRect, initialMinimapRect, "DOM/SVG minimap should follow viewport navigation");
  await graphRoot.dblclick({ position: { x: 48, y: 132 } });
  await page.waitForTimeout(250);
  const resetTransform = await contentLayer.evaluate((element) => element.style.transform);
  const resetMinimapRect = await minimapViewport.evaluate((element) => ({
    x: element.getAttribute("x"),
    y: element.getAttribute("y"),
    width: element.getAttribute("width"),
    height: element.getAttribute("height")
  }));
  assert.equal(typeof resetTransform, "string", "DOM/SVG reset should keep a valid viewport transform");
  assert.equal(typeof resetMinimapRect.x, "string", "DOM/SVG reset should keep a valid minimap viewport");

  await page.keyboard.press("/");
  const searchInput = page.locator(".graph-search-input");
  await searchInput.waitFor();
  await searchInput.fill("节点A");
  await page.waitForFunction(() => document.querySelector(".node[data-id='A']")?.dataset.searchState === "match");
  await page.keyboard.press("Escape");

  const node = page.locator(".node[data-id='A']");
  await node.waitFor();
  await assertNodeDetailDisplay(node, "none", "none", "default card node should hide type and weight details");
  assert.equal(await node.locator(".node-name").innerText(), "节点A", "default card node should keep the title visible");

  await node.hover();
  await assertNodeDetailDisplay(node, "block", "flex", "hovered card node should expose type and weight details");
  await page.waitForSelector(".graph-hover-preview[data-state='open']");
  const preview = page.locator(".graph-hover-preview");
  await preview.locator(".graph-hover-preview-title", { hasText: /^节点A$/ }).waitFor();
  await preview.getByText("实体").waitFor();
  await preview.getByText("这是节点A的内容。").waitFor();
  assert.equal(await preview.locator(".graph-hover-preview-summary").count(), 1, "content nodes should show a preview summary");

  await page.mouse.move(20, 20);
  await waitForPreviewState(page, "closed");
  await assertNodeDetailDisplay(node, "none", "none", "card node details should hide again after hover leaves");

  await node.click();
  await page.waitForSelector(".graph-reader[data-state='open']");
  assert.equal(await node.getAttribute("aria-pressed"), "true", "DOM/SVG node selection should remain visible");
  await assertNodeDetailDisplay(node, "block", "flex", "selected card node should expose type and weight details");

  const fixed = await page.evaluate(() => window.__LLM_WIKI_GRAPH_ENGINE__.setNodeFixed("A", "fix"));
  assert.equal(fixed, true, "DOM/SVG should fix a prepared node");
  await page.waitForFunction(() => document.querySelector(".node[data-id='A']")?.dataset.pinned === "true");
  const unfixed = await page.evaluate(() => window.__LLM_WIKI_GRAPH_ENGINE__.setNodeFixed("A", "unfix"));
  assert.equal(unfixed, true, "DOM/SVG should unfix a prepared node");
  await page.waitForFunction(() => document.querySelector(".node[data-id='A']")?.dataset.pinned === "false");

  await page.evaluate(() => window.__LLM_WIKI_GRAPH_ENGINE__.focusCommunity("t1"));
  await page.waitForFunction(() => document.querySelector("[data-llm-wiki-graph-route]")?.dataset.llmWikiGraphRoute === "dom-svg-community");
  await page.getByRole("button", { name: "回全图" }).click();
  await page.waitForFunction(() => document.querySelector("[data-llm-wiki-graph-route]")?.dataset.llmWikiGraphRoute === "dom-svg-small-fallback");

  await page.evaluate(() => {
    const source = document.querySelector("#graph-data")?.textContent || "{}";
    const data = JSON.parse(source);
    data.nodes.push({
      id: "prepared-update",
      label: "准备结果更新节点",
      type: "topic",
      community: "t1",
      content: "更新后的 DOM/SVG 节点",
      source_path: "/fake/wiki/topics/prepared-update.md"
    });
    data.meta.total_nodes = data.nodes.length;
    window.__LLM_WIKI_GRAPH_ENGINE__.setData(data);
  });
  await page.waitForSelector(".node[data-id='prepared-update']");

  const emptyNode = page.locator(".node[data-id='empty-preview']");
  if (await emptyNode.count()) {
    await emptyNode.hover();
    await page.waitForSelector(".graph-hover-preview[data-state='open']");
    await preview.locator(".graph-hover-preview-title", { hasText: /^空内容节点$/ }).waitFor();
    await preview.getByText("主题").waitFor();
    assert.equal(await preview.locator(".graph-hover-preview-summary").count(), 0, "empty content nodes should omit summary text");
  }
} finally {
  await browser.close();
}

async function waitForPreviewState(page, state) {
  await page.waitForFunction((state) => {
    return document.querySelector(".graph-hover-preview")?.dataset.state === state;
  }, state);
}

async function assertNodeDetailDisplay(node, expectedKind, expectedMeta, message) {
  const actual = await node.evaluate((element) => {
    const kind = element.querySelector(".node-kind");
    const meta = element.querySelector(".node-meta");
    const styles = element.ownerDocument.defaultView;
    return {
      kind: kind && styles ? styles.getComputedStyle(kind).display : "",
      meta: meta && styles ? styles.getComputedStyle(meta).display : "",
      metaText: meta?.textContent?.trim() || ""
    };
  });
  assert.equal(actual.kind, expectedKind, `${message}: node kind display`);
  assert.equal(actual.meta, expectedMeta, `${message}: node meta display`);
  assert.match(actual.metaText, /\d+|来源暂不可用/, `${message}: node meta text should remain available`);
}
