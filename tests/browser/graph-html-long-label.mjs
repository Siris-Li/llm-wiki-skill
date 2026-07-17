import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_HTML_LONG_LABEL_HTML || "";
const expectedLabel = process.env.GRAPH_HTML_LONG_LABEL_TEXT || "";
assert.notEqual(html, "", "GRAPH_HTML_LONG_LABEL_HTML must point at generated HTML");
assert.notEqual(expectedLabel, "", "GRAPH_HTML_LONG_LABEL_TEXT must contain the fixture label");

const browser = await chromium.launch({
  args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");

  const node = page.locator(".node[data-id='long-label']");
  await node.waitFor();
  assert.equal(await node.getAttribute("title"), expectedLabel, "the full label should remain available as the node title");
  assert.equal(await node.locator(".node-name").innerText(), expectedLabel, "the visible label should keep complete text for assistive access");
  const clipping = await node.locator(".node-name").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    };
  });
  assert.equal(clipping.textOverflow, "ellipsis");
  assert.equal(clipping.whiteSpace, "nowrap");
  assert.ok(clipping.scrollWidth > clipping.clientWidth, "the long label should visibly overflow into an ellipsis");

  await node.hover();
  await page.waitForSelector(".graph-hover-preview[data-state='open']");
  assert.equal(await page.locator(".graph-hover-preview-title").innerText(), expectedLabel);

  await node.click();
  await page.waitForSelector(".graph-reader[data-state='open']");
  assert.equal(await page.locator(".graph-reader-title").innerText(), expectedLabel);
} finally {
  await browser.close();
}
