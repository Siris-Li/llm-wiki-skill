import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { chromium } from "playwright";

const availableHtml = process.env.GRAPH_WARNING_AVAILABLE_HTML || "";
const availableGraph = process.env.GRAPH_WARNING_AVAILABLE_GRAPH || "";
const availableWarnings = process.env.GRAPH_WARNING_AVAILABLE_SIDECAR || "";
const mismatchHtml = process.env.GRAPH_WARNING_MISMATCH_HTML || "";
const largeHtml = process.env.GRAPH_WARNING_LARGE_HTML || "";
const tempKnowledgeBase = process.env.GRAPH_WARNING_TEMP_KB || "";
const executablePath = process.env.GRAPH_OFFLINE_WARNING_CHROME_EXECUTABLE || undefined;
const evidenceDir = path.resolve(".tmp/graph-offline-warnings");

for (const [name, value] of Object.entries({ availableHtml, availableGraph, availableWarnings, mismatchHtml, largeHtml })) {
  assert.ok(value, `${name} must be provided`);
}

await rm(evidenceDir, { recursive: true, force: true });
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  await verifyAvailableWarnings();
  await verifyMismatch();
  await verifyLargePayload();
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "failure.txt"), `${error.stack || error}\n`);
  throw error;
} finally {
  await browser.close();
}

async function withOfflinePage(htmlPath, label, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.setOffline(true);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error));
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForSelector('.sigma-global-route[data-route="sigma-global"]');
    await page.waitForSelector(".sigma-global-node-hit-target");
    await run(page);
    assert.equal(errors.length, 0, `${label} leaked browser errors: ${errors.map(String).join("; ")}`);
  } catch (error) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, `${label}.png`), fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

async function verifyAvailableWarnings() {
  const graph = JSON.parse(await readFile(availableGraph, "utf8"));
  const bundle = JSON.parse(await readFile(availableWarnings, "utf8"));
  await withOfflinePage(availableHtml, "available", async (page) => {
    const banner = page.locator('[data-testid="offline-warning-banner"]');
    await banner.waitFor();
    const summaryText = await page.locator('[data-testid="offline-warning-summary"]').innerText();
    const summary = graph.meta.warning_summary;
    for (const value of [summary.total_groups, summary.total_occurrences, summary.error_occurrences, summary.warning_occurrences]) {
      assert.match(summaryText, new RegExp(`\\b${value}\\b`));
    }
    for (const [code, count] of Object.entries(summary.by_code)) {
      assert.ok(summaryText.includes(`${code}: ${count}`), `summary should include ${code}: ${count}`);
    }

    await page.locator('[data-testid="offline-warning-details"] > summary').click();
    const detailsText = await page.locator('[data-testid="offline-warning-details"]').innerText();
    const occurrences = bundle.groups.flatMap((group) => group.occurrences);
    const first = occurrences[0];
    const last = occurrences.at(-1);
    for (const occurrence of [first, last]) {
      assert.ok(detailsText.includes(occurrence.source_path));
      assert.ok(detailsText.includes(occurrence.raw_link));
    }
    for (const candidate of bundle.candidate_sets[0].candidates) assert.ok(detailsText.includes(candidate));

    const bodyText = await page.locator("body").innerText();
    assert.equal(bodyText.includes(tempKnowledgeBase), false, "offline page must not expose temporary knowledge-base path");
    assert.equal(bodyText.includes(os.homedir()), false, "offline page must not expose the current home path");
    assert.equal(await page.getByRole("button", { name: /解决|改名/ }).count(), 0);
  });
}

async function verifyMismatch() {
  await withOfflinePage(mismatchHtml, "mismatch", async (page) => {
    await page.locator('[data-testid="offline-warning-unavailable"]', {
      hasText: "告警详情暂不可用，请重新构建图谱"
    }).waitFor();
    assert.ok(await page.locator(".sigma-global-node-hit-target").count() > 0, "mismatch must keep the graph readable");
  });
}

async function verifyLargePayload() {
  const html = await readFile(largeHtml, "utf8");
  const match = html.match(/<script id="graph-warning-data" type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "large HTML must embed graph-warning-data");
  const exactEmbeddedBytes = Buffer.from(match[1], "utf8");
  assert.ok(zlib.gzipSync(exactEmbeddedBytes, { level: 9 }).length <= 2 * 1024 * 1024);
  const payload = JSON.parse(match[1]);
  assert.equal(payload.warning_details_truncated, true);

  await withOfflinePage(largeHtml, "large", async (page) => {
    await page.locator('[data-testid="offline-warning-truncated"]', {
      hasText: "详情过大，已精简；运行 check 查看完整报告"
    }).waitFor();
    assert.ok(await page.locator(".sigma-global-node-hit-target").count() > 0, "large warnings must keep the graph readable");
  });
}
