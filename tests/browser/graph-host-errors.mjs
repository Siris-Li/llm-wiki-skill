import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const offlineHtml = process.env.GRAPH_HOST_ERROR_OFFLINE_HTML;
const executablePath = process.env.GRAPH_HOST_ERROR_CHROME_EXECUTABLE || undefined;
assert.ok(offlineHtml, "GRAPH_HOST_ERROR_OFFLINE_HTML must point at the generated offline graph");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-graph-host-errors-"));
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  await checkCorruptedEmbeddedData(browser);
  await checkUnavailableStorage(browser, "methods");
  await checkUnavailableStorage(browser, "property");
  await checkSharedCreationFailure(browser);
} finally {
  await browser.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function checkCorruptedEmbeddedData(browser) {
  const html = readOfflineHtml().replace(
    /(<script id="graph-data" type="application\/json">)[\s\S]*?(<\/script>)/,
    "$1\n{not valid graph data\n$2",
  );
  const file = writeVariant("corrupt-data.html", html);
  const { page, pageErrors } = await openOffline(browser, file);
  await page.locator(".offline-error").getByText("图谱数据格式不完整").waitFor();
  assert.equal(pageErrors.length, 0, "corrupted embedded data should not leak an uncaught exception");
  await assertNoInteractiveGraph(page, "corrupted embedded data");
  await page.close();
}

async function checkUnavailableStorage(browser, failureMode) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 840 } });
  await context.setOffline(true);
  await context.addInitScript((mode) => {
    if (mode === "property") {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage is unavailable", "SecurityError");
        },
      });
      return;
    }
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value() {
        throw new DOMException("Storage is unavailable", "SecurityError");
      },
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value() {
        throw new DOMException("Storage is unavailable", "SecurityError");
      },
    });
  }, failureMode);
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto(pathToFileURL(offlineHtml).href, { waitUntil: "load" });
  await page.locator(".offline-storage-warning").getByText("浏览器存储不可用").waitFor();
  await page.waitForSelector(".llm-wiki-graph-engine");
  assert.equal(pageErrors.length, 0, `${failureMode} storage failure should not leak an uncaught exception`);
  assert.ok(await page.locator("canvas").count() > 0, `${failureMode} storage failure should keep the graph canvas readable`);
  assert.equal(await page.evaluate(() => Boolean(window.__LLM_WIKI_GRAPH_ENGINE__)), true, `${failureMode} storage failure should keep the engine usable`);
  await context.close();
}

async function checkSharedCreationFailure(browser) {
  const marker = "engine = window.LlmWikiGraphEngine.createGraphEngine(root, {";
  const injectedFailure = 'throw new Error("shared preparation failed")';
  const html = readOfflineHtml().replace(
    marker,
    `window.LlmWikiGraphEngine.createGraphEngine = function () { throw new Error("shared preparation failed"); };\n      ${marker}`,
  );
  assert.ok(html.includes(injectedFailure), "fixture should inject a deterministic shared creation failure");
  const file = writeVariant("shared-creation-failure.html", html);
  const { page, pageErrors } = await openOffline(browser, file);
  await page.locator(".offline-error").getByText("图谱引擎加载失败").waitFor();
  assert.equal(pageErrors.length, 0, "shared creation failure should not leak an uncaught exception");
  await assertNoInteractiveGraph(page, "shared creation failure");
  await page.close();
}

async function openOffline(browser, file) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 840 } });
  await context.setOffline(true);
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  page.once("close", () => void context.close());
  return { page, pageErrors };
}

async function assertNoInteractiveGraph(page, label) {
  assert.equal(await page.locator("canvas").count(), 0, `${label} should not leave a canvas`);
  assert.equal(await page.locator(".llm-wiki-graph-engine").count(), 0, `${label} should not leave an engine root`);
  assert.equal(await page.locator(".graph-toolbar button").count(), 0, `${label} should not leave graph controls`);
  assert.equal(await page.evaluate(() => Boolean(window.__LLM_WIKI_GRAPH_ENGINE__)), false, `${label} should not publish an engine`);
}

function readOfflineHtml() {
  return fs.readFileSync(offlineHtml, "utf8");
}

function writeVariant(name, html) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, html);
  return file;
}
