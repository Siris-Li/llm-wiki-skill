import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_NODE_SLIM_HTML || "";
assert.notEqual(html, "", "GRAPH_NODE_SLIM_HTML must point at generated HTML");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");

  const node = page.locator(".node[data-id='A']");
  await node.waitFor();
  await assertNodeDetailDisplay(node, "none", "none", "default card node should hide type and weight details");
  assert.equal(await node.locator(".node-name").innerText(), "节点A", "default card node should keep the title visible");

  await node.hover();
  await assertNodeDetailDisplay(node, "block", "flex", "hovered card node should expose type and weight details");

  await page.mouse.move(20, 20);
  await assertNodeDetailDisplay(node, "none", "none", "card node details should hide again after hover leaves");

  await node.click();
  await page.waitForSelector(".graph-reader[data-state='open']");
  await assertNodeDetailDisplay(node, "block", "flex", "selected card node should expose type and weight details");
} finally {
  await browser.close();
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
