#!/bin/bash
# Regression: generated graph HTML supports node drag, persistence, and reset.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRAPH_HTML_BASIC="tests/fixtures/graph-interactive-basic"
GRAPH_HTML_MULTICOMM="tests/fixtures/graph-interactive-multicomm"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_file_contains() {
    local file="$1"
    local text="$2"

    if ! grep -F -- "$text" "$file" > /dev/null; then
        fail "Expected $file to contain: $text"
    fi
}

build_graph_html_fixture() {
    local tmp_dir="$1"
    local fixture_dir="${2:-$GRAPH_HTML_BASIC}"
    local output_dir="$tmp_dir/wiki"

    mkdir -p "$output_dir"
    cp "$REPO_ROOT/$fixture_dir/wiki/graph-data.json" "$output_dir/graph-data.json"

    bash "$REPO_ROOT/scripts/build-graph-html.sh" \
        "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on basic fixture"
}

playwright_available() {
    "${NODE_BIN:-node}" -e "require.resolve('playwright')" > /dev/null 2>&1
}

test_graph_html_has_node_drag_markup() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" 'id="reset-layout"'
    assert_file_contains "$html" "恢复布局"
    assert_file_contains "$html" ".atlas.is-node-dragging"
    assert_file_contains "$html" ".node.is-dragging"
    assert_file_contains "$html" "cursor: grab"
    assert_file_contains "$html" "cursor: grabbing"

    rm -rf "$tmp_dir"
}

test_graph_html_node_drag_assets_are_copied() {
    local tmp_dir output_dir
    tmp_dir="$(mktemp -d)"
    output_dir="$tmp_dir/wiki"

    build_graph_html_fixture "$tmp_dir"

    [ -f "$output_dir/graph-wash.js" ] || fail "graph-wash.js should be copied to output"
    [ -f "$output_dir/graph-wash-helpers.js" ] || fail "graph-wash-helpers.js should be copied to output"
    assert_file_contains "$output_dir/graph-wash.js" "manual-node-positions"

    rm -rf "$tmp_dir"
}

run_browser_drag_check() {
    local fixture_dir="$1"
    local mode="$2"
    local tmp_dir output_dir
    tmp_dir="$(mktemp -d)"
    output_dir="$tmp_dir/wiki"

    build_graph_html_fixture "$tmp_dir" "$fixture_dir"

    "${NODE_BIN:-node}" - <<'NODE' "$output_dir" "$mode" || exit 1
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(process.argv[2]);
const mode = process.argv[3] || "drag";

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(root, requested === "/" ? "knowledge-graph.html" : requested);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function visibleConnectedSubject(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".node")).filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const edges = Array.from(document.querySelectorAll(".edge"));
    for (const edge of edges) {
      const ids = [edge.dataset.from, edge.dataset.to];
      for (const id of ids) {
        const node = nodes.find((item) => item.dataset.id === id);
        if (node) {
          return {
            nodeId: id,
            community: node.dataset.community,
            left: node.style.left,
            top: node.style.top,
            edgeId: edge.dataset.edgeId,
            edgePath: edge.getAttribute("d")
          };
        }
      }
    }
    throw new Error("No visible connected node found");
  });
}

async function elementForNode(page, nodeId) {
  const handle = await page.evaluateHandle((id) => Array.from(document.querySelectorAll(".node")).find((node) => node.dataset.id === id), nodeId);
  const element = handle.asElement();
  if (!element) throw new Error(`Node element not found: ${nodeId}`);
  return element;
}

async function dragNode(page, nodeId, dx, dy) {
  const element = await elementForNode(page, nodeId);
  const box = await element.boundingBox();
  if (!box) throw new Error(`Node has no box: ${nodeId}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

async function beginNodeDrag(page, nodeId, dx, dy) {
  const element = await elementForNode(page, nodeId);
  const box = await element.boundingBox();
  if (!box) throw new Error(`Node has no box: ${nodeId}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await settle(page);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runDragPersistenceReset(page) {
  const subject = await visibleConnectedSubject(page);
  await dragNode(page, subject.nodeId, 90, 55);

  const afterDrag = await page.evaluate((subject) => {
    const node = Array.from(document.querySelectorAll(".node")).find((item) => item.dataset.id === subject.nodeId);
    const edge = Array.from(document.querySelectorAll(".edge")).find((item) => item.dataset.edgeId === subject.edgeId);
    const keys = Object.keys(localStorage).filter((key) => key.endsWith(":manual-node-positions"));
    return {
      left: node && node.style.left,
      top: node && node.style.top,
      edgePath: edge && edge.getAttribute("d"),
      selected: node && node.getAttribute("aria-pressed"),
      reading: document.querySelector(".app") && document.querySelector(".app").dataset.reading,
      resetDisabled: document.getElementById("reset-layout").disabled,
      storageKeyCount: keys.length,
      storagePayload: keys[0] ? JSON.parse(localStorage.getItem(keys[0])) : null
    };
  }, subject);

  assert(afterDrag.left !== subject.left || afterDrag.top !== subject.top, "drag should change node position");
  assert(afterDrag.edgePath !== subject.edgePath, "drag should update connected edge path");
  assert(afterDrag.selected !== "true", "drag should not select the node");
  assert(afterDrag.reading !== "1", "drag should not open reading mode");
  assert(afterDrag.resetDisabled === false, "reset layout should enable after drag");
  assert(afterDrag.storageKeyCount === 1, "manual position should be saved under one wiki-scoped key");
  assert(afterDrag.storagePayload && afterDrag.storagePayload.positions && afterDrag.storagePayload.positions[subject.nodeId], "manual position payload should include dragged node");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".node");
  await settle(page);

  const afterReload = await page.evaluate((subject) => {
    const node = Array.from(document.querySelectorAll(".node")).find((item) => item.dataset.id === subject.nodeId);
    return {
      left: node && node.style.left,
      top: node && node.style.top,
      resetDisabled: document.getElementById("reset-layout").disabled
    };
  }, subject);
  assert(afterReload.left === afterDrag.left && afterReload.top === afterDrag.top, "reload should preserve dragged position");
  assert(afterReload.resetDisabled === false, "reset layout should remain enabled after reload");

  await page.click("#reset-layout");
  await settle(page);

  const afterReset = await page.evaluate((subject) => {
    const node = Array.from(document.querySelectorAll(".node")).find((item) => item.dataset.id === subject.nodeId);
    const keys = Object.keys(localStorage).filter((key) => key.endsWith(":manual-node-positions"));
    return {
      left: node && node.style.left,
      top: node && node.style.top,
      resetDisabled: document.getElementById("reset-layout").disabled,
      storageKeyCount: keys.length
    };
  }, subject);
  assert(afterReset.left === subject.left && afterReset.top === subject.top, "reset should restore original layout");
  assert(afterReset.resetDisabled === true, "reset layout should disable after clearing positions");
  assert(afterReset.storageKeyCount === 0, "reset should clear manual position storage only");

  await dragNode(page, subject.nodeId, 90, 55);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".node");
  await settle(page);
  const persistedBeforeActiveReset = await page.evaluate((nodeId) => {
    const node = Array.from(document.querySelectorAll(".node")).find((item) => item.dataset.id === nodeId);
    return { left: node && node.style.left, top: node && node.style.top };
  }, subject.nodeId);
  assert(
    persistedBeforeActiveReset.left !== subject.left || persistedBeforeActiveReset.top !== subject.top,
    "setup drag should create a saved manual position before active reset"
  );

  await beginNodeDrag(page, subject.nodeId, 72, 44);
  await page.evaluate(() => document.getElementById("reset-layout").click());
  await page.mouse.up();
  await settle(page);
  const afterActiveReset = await page.evaluate((subject) => {
    const node = Array.from(document.querySelectorAll(".node")).find((item) => item.dataset.id === subject.nodeId);
    const keys = Object.keys(localStorage).filter((key) => key.endsWith(":manual-node-positions"));
    return {
      left: node && node.style.left,
      top: node && node.style.top,
      resetDisabled: document.getElementById("reset-layout").disabled,
      storageKeyCount: keys.length
    };
  }, subject);
  assert(afterActiveReset.left === subject.left && afterActiveReset.top === subject.top, "reset during active drag should restore automatic layout");
  assert(afterActiveReset.resetDisabled === true, "reset during active drag should disable reset control");
  assert(afterActiveReset.storageKeyCount === 0, "reset during active drag should clear manual position storage");

  await dragNode(page, subject.nodeId, 1, 1);
  await (await elementForNode(page, subject.nodeId)).click();
  await settle(page);
  const afterClick = await page.evaluate((nodeId) => {
    const node = Array.from(document.querySelectorAll(".node")).find((item) => item.dataset.id === nodeId);
    return {
      selected: node && node.getAttribute("aria-pressed"),
      reading: document.querySelector(".app") && document.querySelector(".app").dataset.reading
    };
  }, subject.nodeId);
  assert(afterClick.selected === "true" || afterClick.reading === "1", "click should still select/open a node after reset");
}

async function runCancelOnCommunityChange(page) {
  const subject = await visibleConnectedSubject(page);
  const targetCommunity = await page.evaluate((currentCommunity) => {
    const button = Array.from(document.querySelectorAll(".nav-item[data-community]")).find((item) => {
      return item.dataset.community && item.dataset.community !== "all" && item.dataset.community !== currentCommunity;
    });
    return button ? button.dataset.community : null;
  }, subject.community);
  if (!targetCommunity) return;

  const element = await elementForNode(page, subject.nodeId);
  const box = await element.boundingBox();
  if (!box) throw new Error(`Node has no box: ${subject.nodeId}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 45, { steps: 6 });
  await page.evaluate((communityId) => {
    const button = Array.from(document.querySelectorAll(".nav-item[data-community]")).find((item) => item.dataset.community === communityId);
    if (button) button.click();
  }, targetCommunity);
  await page.mouse.up();
  await settle(page);

  const result = await page.evaluate((communityId) => {
    return {
      active: document.querySelector(`.nav-item[data-community="${communityId}"]`) &&
        document.querySelector(`.nav-item[data-community="${communityId}"]`).getAttribute("aria-pressed"),
      resetDisabled: document.getElementById("reset-layout").disabled,
      storageKeyCount: Object.keys(localStorage).filter((key) => key.endsWith(":manual-node-positions")).length
    };
  }, targetCommunity);
  assert(result.active === "true", "community change should remain active after drag cancellation");
  assert(result.resetDisabled === true, "cancelled drag should not enable reset");
  assert(result.storageKeyCount === 0, "cancelled drag should not persist manual positions");
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/knowledge-graph.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".node");
    await settle(page);
    if (mode === "cancel") {
      await runCancelOnCommunityChange(page);
    } else {
      await runDragPersistenceReset(page);
    }
    assert(errors.length === 0, `browser console/page errors: ${errors.join("; ")}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
NODE

    rm -rf "$tmp_dir"
}

test_graph_html_node_drag_browser_behavior() {
    if ! playwright_available; then
        fail "Playwright is required for graph node drag browser regression; set NODE_BIN/NODE_PATH to a Node runtime with Playwright installed"
    fi

    run_browser_drag_check "$GRAPH_HTML_BASIC" "drag"
    run_browser_drag_check "$GRAPH_HTML_MULTICOMM" "cancel"
}

main() {
    test_graph_html_has_node_drag_markup
    test_graph_html_node_drag_assets_are_copied
    test_graph_html_node_drag_browser_behavior
    echo "PASS: graph HTML node drag regression coverage"
}

main "$@"
