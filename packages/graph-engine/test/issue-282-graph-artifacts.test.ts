import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

// Issue #282: 迁移收尾时,工作台(ESM)与离线(IIFE)两种发布产物必须都能被各自宿主加载使用。
// 这份测试是确定性的快速门禁(无浏览器),随引擎单测一起跑;重型真机性能验收走
// tests/issue-282-performance-acceptance.sh。这里始终从当前源码重新构建，避免本地遗留的
// dist 让退休检查误报成功或失败。
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ENGINE_DIST = path.join(REPO_ROOT, "packages/graph-engine/dist");
const ESM_PATH = path.join(ENGINE_DIST, "engine.esm.js");
const IIFE_PATH = path.join(ENGINE_DIST, "engine.iife.js");
const DECLARATION_PATH = path.join(ENGINE_DIST, "index.d.ts");
const ESM_MAP_PATH = path.join(ENGINE_DIST, "engine.esm.js.map");
const IIFE_MAP_PATH = path.join(ENGINE_DIST, "engine.iife.js.map");
const SUPPORTED_EXPORTS_PATH = path.join(import.meta.dirname, "fixtures/issue-159/supported-exports.json");
const RETIRED_ARTIFACT_MARKERS = [
  "legacy-helpers",
  "model/learning",
  "model/queue",
  "model/storage",
  "applyFocusMode",
  "appendQueueNote",
  "atlasPointToMinimap",
  "atlasViewportRect",
  "atlasViewportToMinimapRect",
  "centerAtlasViewportOnPoint",
  "clampAtlasViewport",
  "createSafeStorage",
  "defaultLearning",
  "defaultQueue",
  "fitAtlasViewport",
  "filterLinksByTypes",
  "getAtlasModelBounds",
  "getCommunityNodeIds",
  "getVisibleLinks",
  "getVisibleNodeIds",
  "getWikiStorageNamespace",
  "minimapPointToAtlasPoint",
  "normalizeAtlasViewport",
  "normalizeLearning",
  "normalizeQueue",
  "resolveAtlasVisibleSnapshot",
  "resolveInitialMode",
  "resolveVisibleSnapshot",
  "shouldAutoOpenDrawer",
  "summarizeQueue",
  "toggleQueueFavorite",
  "zoomAtlasViewport"
] as const;
// 产物字节下限:仅防"空壳/未真实构建",不断言精确字节数(随实现演进);精确值记入验收结论文档。
const MIN_ARTIFACT_BYTES = 50_000;

// build-graph-html.sh 通过 window.LlmWikiGraphEngine.<name> 消费的离线宿主全局。
// 从 supported-exports.json 派生(单一事实来源),避免与本测试硬编列表漂移。
const OFFLINE_HOST_GLOBALS = (JSON.parse(fs.readFileSync(SUPPORTED_EXPORTS_PATH, "utf8")) as {
  offlineHost: string[];
}).offlineHost;

// 工作台 ESM 入口的采样烟雾测试(两个高流量运行时入口);workbenchWeb 的完整导出面
// (其余运行时函数与类型)由 supported-exports.test.ts 权威锁定,这里不重复。
const WORKBENCH_RUNTIME_ENTRIES = ["createGraphEngine", "buildCommunityAggregationMarkers"];

describe("issue #282 graph artifacts (ESM + IIFE dual host)", () => {
  ensureEngineBuilt();

  it("loads the ESM artifact used by the workbench and exposes its engine entry points", async () => {
    const namespace = await import(pathToFileURL(ESM_PATH).href) as Record<string, unknown>;
    for (const name of WORKBENCH_RUNTIME_ENTRIES) {
      assert.equal(typeof namespace[name], "function", `ESM artifact must export ${name}`);
    }
  });

  it("loads the IIFE artifact used by the offline host and exposes the offline globals", () => {
    const code = fs.readFileSync(IIFE_PATH, "utf8");
    const context: Record<string, unknown> = {};
    vm.createContext(context);
    vm.runInContext(code, context, { filename: "engine.iife.js" });
    const namespace = context.LlmWikiGraphEngine as Record<string, unknown> | undefined;
    assert.ok(namespace, "IIFE artifact must register the LlmWikiGraphEngine global");
    for (const name of OFFLINE_HOST_GLOBALS) {
      assert.equal(typeof namespace[name], "function", `IIFE artifact must expose offline global ${name}`);
    }
  });

  it("contains no retired toolbox path, export, or source-map source", () => {
    for (const artifact of [ESM_PATH, IIFE_PATH, DECLARATION_PATH, ESM_MAP_PATH, IIFE_MAP_PATH]) {
      const content = fs.readFileSync(artifact, "utf8");
      for (const marker of RETIRED_ARTIFACT_MARKERS) {
        assert.equal(content.includes(marker), false, `${path.basename(artifact)} must not contain ${marker}`);
      }
    }
  });

  it("records non-trivial byte sizes for both artifacts", () => {
    const esmSize = fs.statSync(ESM_PATH).size;
    const iifeSize = fs.statSync(IIFE_PATH).size;
    assert.ok(esmSize > MIN_ARTIFACT_BYTES, `ESM artifact too small: ${esmSize} bytes`);
    assert.ok(iifeSize > MIN_ARTIFACT_BYTES, `IIFE artifact too small: ${iifeSize} bytes`);
    // 供调试与结论文档参考(本机路径不出现在断言里)。
    console.log(`issue-282 artifact sizes: esm=${esmSize} iife=${iifeSize}`);
  });
});

function ensureEngineBuilt(): void {
  execSync("npm run build -w @llm-wiki/graph-engine", { cwd: REPO_ROOT, stdio: "inherit" });
}
