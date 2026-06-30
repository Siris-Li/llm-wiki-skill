import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const renderDir = new URL("../src/render/", import.meta.url);
const testDir = new URL("./", import.meta.url);

const rendererBoundaryExcludedFiles = new Set(["sigma-global-renderer.ts"]);
const sigmaInternalSupportFiles = ["community-cloud-geometry.ts"] as const;
const sigmaInternalModulesWithoutHostCallbacks = [
  "community-cloud-geometry.ts",
  "sigma-coordinates.ts",
  "sigma-events.ts",
  "sigma-global-camera.ts",
  "sigma-global-drag.ts",
  "sigma-graphology-model.ts",
  "sigma-hit-projector.ts",
  "sigma-overlay-dom.ts",
  "sigma-overlay-svg.ts",
  "sigma-wheel-zoom.ts",
  "sigma-zoom.ts"
] as const;
const forbiddenRendererEntrypointExportModules = [
  "sigma-graphology-model",
  "sigma-hit-projector"
] as const;
const forbiddenRendererEntrypointInternalNames = [
  "buildSigmaGlobalGraphologyGraph",
  "sigmaGlobalEdgeStyle",
  "createSigmaGlobalHitProjector",
  "SigmaGlobalEdgeStyle",
  "SigmaGlobalHitInput",
  "SigmaGlobalHitProjector",
  "SigmaGlobalHitProjectorInput",
  "SigmaGlobalRenderedObject"
] as const;
const forbiddenRendererEntrypointImportPattern =
  /import\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+["'][^"']*sigma-global-renderer(?:\.[jt]s)?["']/g;
const forbiddenRendererEntrypointNamespaceImportPattern =
  /import\s+\*\s+as\s+\w+\s+from\s+["'][^"']*sigma-global-renderer(?:\.[jt]s)?["']/;
const forbiddenSigmaInternalHostIdentifiers = [
  "GraphEngineCapabilities",
  "GraphFacadeRendererCallbacks",
  "GraphOpenPagePayload",
  "onOpenPage",
  "onSelectionChange",
  "onSelectionClear",
  "onViewReset",
  "onGlobalResetRequested",
  "onVisibilityStateChange",
  "onSelectionInput",
  "onSelectionClearRequested",
  "onNodeOpen",
  "onAsk",
  "persistPins",
  "onPinsChanged",
  "onHitTarget",
  "onDragActiveChange",
  "onDragStateChange",
  "focusCommunity",
  "createGraphWorkbenchCapabilities",
  "createGraphOfflineCapabilities"
] as const;

describe("Sigma global renderer refactor boundaries", () => {
  it("keeps shared helper modules from importing the renderer", async () => {
    for (const file of await sigmaInternalHelperFiles()) {
      const source = await readFile(new URL(`../src/render/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from\s+["']\.\/sigma-global-renderer(?:\.[jt]s)?["']/);
    }
  });

  it("keeps Sigma internal helpers out of the render package barrel", async () => {
    const source = await readFile(new URL("../src/render/index.ts", import.meta.url), "utf8");
    for (const file of await sigmaInternalHelperFiles()) {
      const moduleName = file.replace(/\.ts$/, "");
      assert.doesNotMatch(source, new RegExp(`from\\s+["']\\./${moduleName}(?:\\.js)?["']`));
    }
  });

  it("keeps the shared type file type-only", async () => {
    const source = await readFile(new URL("../src/render/sigma-global-types.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /^\s*export\s+(?!type\b|interface\b)/m);
  });

  it("keeps the renderer entrypoint from re-exporting Sigma internal helpers", async () => {
    const source = await readFile(new URL("../src/render/sigma-global-renderer.ts", import.meta.url), "utf8");
    for (const moduleName of forbiddenRendererEntrypointExportModules) {
      const pattern = new RegExp(
        `export\\s+(?:type\\s+)?(?:\\*|\\*\\s+as\\s+\\w+|\\{[\\s\\S]*?\\})\\s+from\\s+["']\\./${moduleName}(?:\\.[jt]s)?["']`
      );
      assert.doesNotMatch(source, pattern);
    }
  });

  it("keeps graph-engine tests from importing internals through the renderer entrypoint", async () => {
    const violations: string[] = [];
    const forbiddenNamePattern = new RegExp(`\\b(?:${forbiddenRendererEntrypointInternalNames.join("|")})\\b`);
    for (const file of await graphEngineTestFiles()) {
      const source = await readFile(new URL(file, testDir), "utf8");
      if (forbiddenRendererEntrypointNamespaceImportPattern.test(source)) {
        violations.push(`${file}: namespace import from sigma-global-renderer`);
      }
      for (const match of source.matchAll(forbiddenRendererEntrypointImportPattern)) {
        if (forbiddenNamePattern.test(match[0])) {
          violations.push(`${file}: internal helper imported through sigma-global-renderer`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });

  it("keeps Sigma internal modules out of facade, drawer, and host callback ownership", async () => {
    const violations: string[] = [];
    for (const file of sigmaInternalModulesWithoutHostCallbacks) {
      const source = await readFile(new URL(`../src/render/${file}`, import.meta.url), "utf8");
      for (const identifier of forbiddenSigmaInternalHostIdentifiers) {
        if (new RegExp(`\\b${identifier}\\b`).test(source)) violations.push(`${file}: ${identifier}`);
      }
    }

    assert.deepEqual(violations, []);
  });
});

async function sigmaInternalHelperFiles(): Promise<string[]> {
  const entries = await readdir(renderDir);
  return [
    ...entries
      .filter((file) => file.startsWith("sigma-") && file.endsWith(".ts"))
      .filter((file) => !rendererBoundaryExcludedFiles.has(file)),
    ...sigmaInternalSupportFiles
  ].sort();
}

async function graphEngineTestFiles(): Promise<string[]> {
  const entries = await readdir(testDir);
  return entries
    .filter((file) => file.endsWith(".test.ts"))
    .sort();
}
