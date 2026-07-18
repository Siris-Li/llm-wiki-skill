import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

// Issue #282: 迁移收尾时,工作台(ESM)与离线(IIFE)两种发布产物必须都能被各自宿主加载使用。
// 这份测试是确定性的快速门禁(无浏览器),随引擎单测一起跑;重型真机性能验收走
// tests/issue-282-performance-acceptance.sh。dist 在 CI 的 build-graph 步骤已构建,
// 独立运行时由 ensureEngineBuilt 兜底构建一次。
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ENGINE_DIST = path.join(REPO_ROOT, "packages/graph-engine/dist");
const ESM_PATH = path.join(ENGINE_DIST, "engine.esm.js");
const IIFE_PATH = path.join(ENGINE_DIST, "engine.iife.js");

// build-graph-html.sh 通过 window.LlmWikiGraphEngine.<name> 消费的离线宿主全局(fixtures/issue-159/supported-exports.json)。
const OFFLINE_HOST_GLOBALS = [
  "createGraphEngine",
  "createGraphOfflineCapabilities",
  "normalizeGraphLayoutFile",
  "normalizeGraphPinMap"
];

// 工作台 ESM 入口里最关键的两个运行时入口(其余为类型)。
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

  it("records non-trivial byte sizes for both artifacts", () => {
    const esmSize = fs.statSync(ESM_PATH).size;
    const iifeSize = fs.statSync(IIFE_PATH).size;
    // 下限只防“空壳/未真实构建”,不断言精确字节数(随实现演进);精确值记入验收结论文档。
    const FLOOR = 50_000;
    assert.ok(esmSize > FLOOR, `ESM artifact too small: ${esmSize} bytes`);
    assert.ok(iifeSize > FLOOR, `IIFE artifact too small: ${iifeSize} bytes`);
    // 供调试与结论文档参考(本机路径不出现在断言里)。
    console.log(`issue-282 artifact sizes: esm=${esmSize} iife=${iifeSize}`);
  });
});

function ensureEngineBuilt(): void {
  if (fs.existsSync(ESM_PATH) && fs.existsSync(IIFE_PATH)) return;
  execSync("npm run build -w @llm-wiki/graph-engine", { cwd: REPO_ROOT, stdio: "inherit" });
}
