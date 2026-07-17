import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  auditGraphSourceDependencies,
  readTypeScriptModuleGraph,
  type GraphDependencyBaseline
} from "./support/source-dependencies";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_PATH = path.join(import.meta.dirname, "fixtures/issue-159/dependency-baseline.json");

describe("issue #159 source dependency gate", () => {
  it("matches the migration allowlist, which may shrink but may not grow", async () => {
    const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as GraphDependencyBaseline;
    const graph = await readTypeScriptModuleGraph(path.join(PACKAGE_ROOT, "src"));

    assert.deepEqual(auditGraphSourceDependencies(graph, baseline), []);
  });

  it("resolves imports, dynamic imports, and re-exports before checking forbidden routes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-dependencies-"));
    try {
      await mkdir(path.join(root, "model"), { recursive: true });
      await mkdir(path.join(root, "render"), { recursive: true });
      await writeFile(path.join(root, "model/legacy-helpers.ts"), "export const legacy = true;\n");
      await writeFile(path.join(root, "model/index.ts"), "export * from './legacy-helpers';\n");
      await writeFile(path.join(root, "render/sigma-global-renderer.ts"), [
        "import { legacy } from '../model/legacy-helpers';",
        "export { legacy as hidden } from '../model';",
        "export async function late() { return import('../model/legacy-helpers'); }"
      ].join("\n"));

      const graph = await readTypeScriptModuleGraph(root);
      const findings = auditGraphSourceDependencies(graph, {
        legacyReferences: [
          {
            source: "model/index.ts",
            target: "model/legacy-helpers.ts",
            specifier: "./legacy-helpers",
            kind: "re-export"
          },
          {
            source: "render/sigma-global-renderer.ts",
            target: "model/legacy-helpers.ts",
            specifier: "../model/legacy-helpers",
            kind: "dynamic-import"
          }
        ],
        internalModelBarrelReferences: []
      });

      assert.deepEqual(findings.map((finding) => finding.rule), [
        "legacy-reference-growth",
        "internal-model-barrel-growth",
        "renderer-route-bypasses-shared-snapshot",
        "renderer-route-bypasses-shared-snapshot",
        "renderer-route-bypasses-shared-snapshot"
      ]);
      assert.deepEqual(
        graph.edges.filter((edge) => edge.source === "render/sigma-global-renderer.ts").map((edge) => edge.kind),
        ["import", "re-export", "dynamic-import"]
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let an allowed type-only renderer import become a runtime bypass", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-type-dependencies-"));
    try {
      await mkdir(path.join(root, "model"), { recursive: true });
      await mkdir(path.join(root, "render"), { recursive: true });
      await writeFile(path.join(root, "model/atlas.ts"), "export interface AtlasModel { id: string; }\nexport const atlas = { id: 'atlas' };\n");
      const rendererPath = path.join(root, "render/sigma-global-renderer.ts");
      await writeFile(rendererPath, "import type { AtlasModel } from '../model/atlas';\nexport type Snapshot = AtlasModel;\n");
      const typeOnlyGraph = await readTypeScriptModuleGraph(root);
      const typeOnlyEdge = typeOnlyGraph.edges.find((edge) => edge.source === "render/sigma-global-renderer.ts");
      assert.ok(typeOnlyEdge);
      assert.equal(typeOnlyEdge.typeOnly, true);

      await writeFile(rendererPath, "import { atlas } from '../model/atlas';\nexport const snapshot = atlas;\n");
      const runtimeGraph = await readTypeScriptModuleGraph(root);
      const findings = auditGraphSourceDependencies(runtimeGraph, {
        legacyReferences: [],
        internalModelBarrelReferences: [],
        rendererRouteBypasses: [typeOnlyEdge]
      });

      assert.deepEqual(findings.map((finding) => finding.rule), ["renderer-route-bypasses-shared-snapshot"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
