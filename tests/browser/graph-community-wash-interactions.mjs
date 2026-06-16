import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const html = process.env.GRAPH_COMMUNITY_WASH_HTML || "";
assert.notEqual(html, "", "GRAPH_COMMUNITY_WASH_HTML must point at generated HTML");

const executablePath = process.env.GRAPH_COMMUNITY_WASH_CHROME_EXECUTABLE || "";
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(pathToFileURL(html).href);
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await page.waitForSelector(".community-wash");

  const communityId = await multiNodeCommunityId(page);
  const expectedCommunityNodes = await nodesInCommunity(page, communityId);

  const washPoint = await findCommunityWashPoint(page, communityId);
  const initialTransform = await layerTransform(page);
  await page.mouse.move(washPoint.x, washPoint.y);
  await page.mouse.wheel(0, -560);
  const zoomedTransform = await waitForLayerTransform(page, initialTransform);
  assert.notEqual(zoomedTransform, initialTransform, "wheel over community wash should zoom the graph");

  const clickPoint = await findCommunityWashPoint(page, communityId);
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await waitForVisibleNodeIds(page, expectedCommunityNodes);
  assert.deepEqual(
    await visibleNodeIds(page),
    expectedCommunityNodes,
    "clicking a community wash should enter that community without showing outside nodes"
  );

  await resetToFreshGraph(page);

  const movedPoint = await findCommunityWashPoint(page, communityId);
  await page.mouse.move(movedPoint.x, movedPoint.y);
  await page.mouse.down();
  await page.mouse.move(movedPoint.x + 28, movedPoint.y + 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  assert.deepEqual(
    await visibleNodeIds(page),
    ["A", "B", "C"],
    "moving on a community wash past the click threshold should cancel the community click"
  );

  await resetToFreshGraph(page);

  const dragEvidence = await dragNodeOutsideInitialWash(page, expectedCommunityNodes[0], communityId);
  assert.ok(
    dragEvidence.nodeCenter.x > dragEvidence.initialWashRect.right + 36,
    `node should be able to move beyond the initial community wash bounds: ${JSON.stringify(dragEvidence)}`
  );
  assert.equal(dragEvidence.pinned, "true", "dragging a node outside the wash should still commit a pin");
  assert.equal(dragEvidence.dragging, "", "community wash should not leave a drag stuck active");

  console.log(JSON.stringify({
    communityId,
    washWheel: { before: initialTransform, after: zoomedTransform, point: washPoint },
    communityClickVisibleNodes: expectedCommunityNodes,
    thresholdMoveVisibleNodes: ["A", "B", "C"],
    dragEvidence
  }, null, 2));
} finally {
  await browser.close();
}

async function layerTransform(page) {
  return page.locator("[data-viewport-layer='true']").evaluate((element) => element.style.transform);
}

async function waitForLayerTransform(page, previous) {
  await page.waitForFunction(
    (previous) => document.querySelector("[data-viewport-layer='true']")?.style.transform !== previous,
    previous,
    { timeout: 3000 }
  );
  return layerTransform(page);
}

async function resetToFreshGraph(page) {
  await page.reload();
  await page.waitForSelector("[data-llm-wiki-graph-root='true']");
  await page.waitForSelector("[data-viewport-layer='true']");
  await page.waitForSelector(".community-wash");
  await page.waitForFunction(() => document.querySelectorAll(".node").length === 3);
}

async function visibleNodeIds(page) {
  return page.locator(".node").evaluateAll((nodes) => nodes.map((node) => node.dataset.id).sort());
}

async function waitForVisibleNodeIds(page, expected) {
  await page.waitForFunction((expected) => {
    const actual = [...document.querySelectorAll(".node")].map((node) => node.dataset.id).sort();
    return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
  }, expected);
}

async function multiNodeCommunityId(page) {
  return page.evaluate(() => {
    const counts = new Map();
    for (const node of document.querySelectorAll(".node")) {
      const id = node.dataset.community || "";
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count > 1 && document.querySelector(`.community-wash[data-community-id="${CSS.escape(id)}"]`)) return id;
    }
    throw new Error(`Could not find a multi-node community wash: ${JSON.stringify([...counts])}`);
  });
}

async function nodesInCommunity(page, communityId) {
  return page.evaluate((communityId) => {
    return [...document.querySelectorAll(".node")]
      .filter((node) => node.dataset.community === communityId)
      .map((node) => node.dataset.id)
      .sort();
  }, communityId);
}

async function findCommunityWashPoint(page, communityId) {
  return page.evaluate((communityId) => {
    const wash = communityId
      ? document.querySelector(`.community-wash[data-community-id="${CSS.escape(communityId)}"]`)
      : document.querySelector(".community-wash");
    if (!wash) throw new Error("Missing community wash");
    const rect = wash.getBoundingClientRect();
    const candidates = [
      [0.5, 0.18],
      [0.2, 0.5],
      [0.8, 0.5],
      [0.5, 0.82],
      [0.32, 0.32],
      [0.68, 0.68],
      [0.5, 0.5]
    ];
    for (const [rx, ry] of candidates) {
      const x = rect.left + rect.width * rx;
      const y = rect.top + rect.height * ry;
      if (document.elementFromPoint(x, y)?.closest?.(".community-wash") === wash) {
        return { x, y, communityId: wash.dataset.communityId || "" };
      }
    }
    throw new Error(`Could not find an exposed community wash point in ${JSON.stringify({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    })}`);
  }, communityId);
}

async function dragNodeOutsideInitialWash(page, nodeId, communityId) {
  const initial = await page.evaluate(({ nodeId, communityId }) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const wash = document.querySelector(`.community-wash[data-community-id="${CSS.escape(communityId)}"]`);
    const node = document.querySelector(`.node[data-id="${CSS.escape(nodeId)}"]`);
    if (!root || !wash || !node) throw new Error("Missing graph elements for wash drag evidence");
    const rootRect = root.getBoundingClientRect();
    const washRect = wash.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const relativeRect = (rect) => ({
      left: rect.left - rootRect.left,
      top: rect.top - rootRect.top,
      right: rect.right - rootRect.left,
      bottom: rect.bottom - rootRect.top,
      width: rect.width,
      height: rect.height
    });
    return {
      rootRect: relativeRect(rootRect),
      washRect: relativeRect(washRect),
      nodeCenter: {
        x: nodeRect.left + nodeRect.width / 2,
        y: nodeRect.top + nodeRect.height / 2
      }
    };
  }, { nodeId, communityId });

  await page.mouse.move(initial.nodeCenter.x, initial.nodeCenter.y);
  await page.mouse.down();
  await page.mouse.move(initial.nodeCenter.x + 520, initial.nodeCenter.y + 22, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector(`.node[data-id="${nodeId}"][data-pinned="true"]`);
  await page.waitForTimeout(120);

  return page.evaluate((input) => {
    const root = document.querySelector("[data-llm-wiki-graph-root='true']");
    const node = document.querySelector(`.node[data-id="${CSS.escape(input.nodeId)}"]`);
    if (!root || !node) throw new Error("Missing graph elements after wash drag");
    const rootRect = root.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      initialWashRect: input.initialWashRect,
      nodeCenter: {
        x: nodeRect.left + nodeRect.width / 2 - rootRect.left,
        y: nodeRect.top + nodeRect.height / 2 - rootRect.top
      },
      pinned: node.dataset.pinned,
      dragging: root.dataset.dragging || ""
    };
  }, { nodeId, initialWashRect: initial.washRect });
}
