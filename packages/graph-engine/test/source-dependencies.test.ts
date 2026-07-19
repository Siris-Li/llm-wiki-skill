import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  auditGraphSourceDependencies,
  readTypeScriptModuleGraph,
  type GraphDependencyBaseline
} from "./support/source-dependencies";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const BASELINE_PATH = path.join(import.meta.dirname, "fixtures/issue-159/dependency-baseline.json");
const RETIRED_REPOSITORY_PATHS = [
  "packages/graph-engine/src/model/legacy-helpers.ts",
  "packages/graph-engine/src/model/learning.ts",
  "packages/graph-engine/src/model/queue.ts",
  "packages/graph-engine/src/model/storage.ts",
  "packages/graph-engine/test/learning.test.ts",
  "templates/graph-styles/wash/footer.html",
  "templates/graph-styles/wash/graph-wash-helpers.js",
  "templates/graph-styles/wash/graph-wash.js",
  "templates/graph-styles/wash/header.html",
  "tests/expected/graph-interactive-basic.html",
  "tests/js/graph-wash-bootstrap.test.js",
  "tests/js/graph-wash-helpers.test.js",
  "tests/js/graph-wash-learning.test.js",
  "tests/js/graph-wash-queue.test.js",
  "tests/js/graph-wash-runtime-state.test.js"
] as const;

describe("issue #159 source dependency gate", () => {
  it("has no real source dependency on the retired legacy toolbox", async () => {
    const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as GraphDependencyBaseline;
    const graph = await readTypeScriptModuleGraph(path.join(PACKAGE_ROOT, "src"));

    assert.deepEqual(baseline.legacyReferences, []);
    assert.deepEqual(
      graph.edges.filter((edge) => edge.target === "model/legacy-helpers.ts"),
      []
    );
    assert.deepEqual(auditGraphSourceDependencies(graph, baseline), []);
  });

  it("keeps retired toolbox and wash source paths absent from the repository", async () => {
    for (const retiredPath of RETIRED_REPOSITORY_PATHS) {
      await assert.rejects(
        access(path.join(REPO_ROOT, retiredPath)),
        `${retiredPath} must stay retired`
      );
    }
  });

  it("resolves imports, dynamic imports, and re-exports before checking forbidden routes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-dependencies-"));
    try {
      await mkdir(path.join(root, "model"), { recursive: true });
      await mkdir(path.join(root, "render"), { recursive: true });
      await writeFile(path.join(root, "model/legacy-helpers.ts"), "export const legacy = true;\n");
      await writeFile(path.join(root, "model/index.ts"), "export * from './legacy-helpers';\n");
      await writeFile(path.join(root, "render/migration-renderer.ts"), [
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
            source: "render/migration-renderer.ts",
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
        graph.edges.filter((edge) => edge.source === "render/migration-renderer.ts").map((edge) => edge.kind),
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
      await writeFile(rendererPath, "export { type AtlasModel } from '../model/atlas';\n");
      const typeOnlyGraph = await readTypeScriptModuleGraph(root);
      const typeOnlyEdge = typeOnlyGraph.edges.find((edge) => edge.source === "render/sigma-global-renderer.ts");
      assert.ok(typeOnlyEdge);
      assert.equal(typeOnlyEdge.typeOnly, true);
      assert.deepEqual(auditGraphSourceDependencies(typeOnlyGraph, {
        legacyReferences: [],
        internalModelBarrelReferences: [],
        rendererRouteBypasses: []
      }), []);

      await writeFile(rendererPath, "import { atlas } from '../model/atlas';\nexport const snapshot = atlas;\n");
      const runtimeGraph = await readTypeScriptModuleGraph(root);
      const findings = auditGraphSourceDependencies(runtimeGraph, {
        legacyReferences: [],
        internalModelBarrelReferences: [],
        rendererRouteBypasses: []
      });

      assert.ok(findings.some((finding) => finding.rule === "renderer-route-bypasses-shared-snapshot"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("covers import types, import-equals, require calls, and every scanned renderer extension", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-module-forms-"));
    try {
      await mkdir(path.join(root, "model"), { recursive: true });
      await mkdir(path.join(root, "render"), { recursive: true });
      await writeFile(path.join(root, "model/legacy-helpers.ts"), "export interface LegacyType { id: string; }\nexport const legacy = true;\n");
      await writeFile(path.join(root, "render/type-renderer.tsx"), "export type Snapshot = import('../model/legacy-helpers').LegacyType;\n");
      await writeFile(path.join(root, "render/equals-renderer.mts"), "import legacyModule = require('../model/legacy-helpers');\nexport { legacyModule };\n");
      await writeFile(path.join(root, "render/require-renderer.cts"), "export const legacyModule = require('../model/legacy-helpers');\n");

      const graph = await readTypeScriptModuleGraph(root);
      const findings = auditGraphSourceDependencies(graph, {
        legacyReferences: [],
        internalModelBarrelReferences: [],
        rendererRouteBypasses: []
      });

      assert.deepEqual(
        graph.edges.map((edge) => [edge.source, edge.kind, edge.typeOnly]),
        [
          ["render/equals-renderer.mts", "import", false],
          ["render/require-renderer.cts", "require", false],
          ["render/type-renderer.tsx", "import-type", true]
        ]
      );
      assert.deepEqual(findings.map((finding) => finding.rule), [
        "legacy-reference-growth",
        "legacy-reference-growth",
        "legacy-reference-growth",
        "renderer-route-bypasses-shared-snapshot",
        "renderer-route-bypasses-shared-snapshot"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the zero legacy baseline from accepting a newly introduced old path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-zero-legacy-"));
    try {
      await mkdir(path.join(root, "model"), { recursive: true });
      await writeFile(path.join(root, "model/legacy-helpers.ts"), "export const legacy = true;\n");
      await writeFile(path.join(root, "model/consumer.ts"), "export { legacy } from './legacy-helpers';\n");

      const graph = await readTypeScriptModuleGraph(root);
      assert.deepEqual(
        auditGraphSourceDependencies(graph, {
          legacyReferences: [],
          internalModelBarrelReferences: [],
          rendererRouteBypasses: []
        }).map((finding) => finding.rule),
        ["legacy-reference-growth"]
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps semantic visibility independent from layout, camera, rendering, and hosts", async () => {
    const graph = await readTypeScriptModuleGraph(path.join(PACKAGE_ROOT, "src"));
    const visibilityEdges = graph.edges.filter((edge) => edge.source === "model/visibility.ts");

    assert.deepEqual(
      visibilityEdges.map((edge) => [edge.target, edge.typeOnly]),
      [
        ["types.ts", true],
        ["model/atlas.ts", true]
      ]
    );
  });

  it("keeps render/model as an assembly layer instead of a second policy owner", async () => {
    const graph = await readTypeScriptModuleGraph(path.join(PACKAGE_ROOT, "src"));
    const modelEdges = graph.edges
      .filter((edge) => edge.source === "render/model.ts")
      .map((edge) => [edge.target, edge.typeOnly]);

    assert.deepEqual(modelEdges, [
      ["types.ts", true],
      ["model/atlas.ts", false],
      ["layout/initial-layout.ts", false],
      ["render/render-policy.ts", false]
    ]);
  });

  it("keeps renderer adaptation downstream of prepared snapshots and semantics", async () => {
    const graph = await readTypeScriptModuleGraph(path.join(PACKAGE_ROOT, "src"));
    const adapterEdges = graph.edges
      .filter((edge) => edge.source === "render/adapter.ts")
      .map((edge) => [edge.target, edge.typeOnly]);

    assert.deepEqual(adapterEdges, [
      ["types.ts", false],
      ["types.ts", true],
      ["render/render-policy.ts", true],
      ["render/relation-focus.ts", true]
    ]);
    assert.equal(adapterEdges.some(([target]) => target === "render/model.ts" || target === "model/atlas.ts"), false);
  });

  it("keeps Sigma and DOM/SVG consumers from rebuilding drawing facts from model or summary owners", async () => {
    const graph = await readTypeScriptModuleGraph(path.join(PACKAGE_ROOT, "src"));
    const consumers = new Set([
      "graph-routes/sigma-global-route.ts",
      "render/dom-svg-renderer.ts",
      "render/render-pipeline.ts"
    ]);
    const violations = graph.edges
      .filter((edge) => consumers.has(edge.source) && !edge.typeOnly)
      .filter((edge) => edge.target.startsWith("model/") || edge.target === "render/model.ts" || edge.target.startsWith("summary/"))
      .map((edge) => [edge.source, edge.target]);

    assert.deepEqual(violations, []);
  });
});
