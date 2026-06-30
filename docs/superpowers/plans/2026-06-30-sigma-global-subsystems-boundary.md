# Sigma Global Subsystems Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal the Sigma global route subsystem boundaries from #79 with documentation, automated guard tests, and cleanup of test-only internal re-exports.

**Architecture:** Keep `createSigmaGlobalRenderer` as the Sigma global lifecycle entrypoint. Internal modules stay directly importable for focused tests, but the renderer entrypoint stops re-exporting Graphology model and hit-projector helpers. Boundary tests enforce dependency direction, export surface, host-callback ownership, and test import discipline.

**Tech Stack:** TypeScript ESM, Node `node:test`, Graphology, Sigma, existing graph-engine fake runtime tests, Markdown project docs.

---

## Scope Check

This plan implements only #79:

- It documents and guards Sigma global subsystem boundaries.
- It does not implement #75 performance work.
- It does not change user-visible graph behavior.
- It does not split `sigma-global-renderer.ts` again.
- It does not change the graph route model, drawer model, or community view.

The spec covers one bounded route-hardening effort. It touches tests, internal exports, and product docs, but these are coupled parts of the same boundary contract rather than independent products.

## File Structure

### Create

- `docs/superpowers/plans/2026-06-30-sigma-global-subsystems-boundary.md`
  This implementation plan.

### Modify

- `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
  Expands the Sigma boundary contract. It becomes the canonical guard for no helper-to-renderer dependency, no render barrel export drift, no renderer entrypoint re-export of internal helpers, no renderer test importing internals through the renderer, and no host callback names inside internal Sigma modules.

- `packages/graph-engine/test/sigma-global-renderer.test.ts`
  Keeps lifecycle and integration coverage, but imports Graphology model helpers and hit projector helpers from their real modules instead of the renderer entrypoint.

- `packages/graph-engine/src/render/sigma-global-renderer.ts`
  Keeps the public lifecycle entrypoint, runtime boundary, stable constants, and public renderer types. Removes test-only re-exports for `buildSigmaGlobalGraphologyGraph`, `sigmaGlobalEdgeStyle`, `createSigmaGlobalHitProjector`, and hit-projector helper types.

- `workbench/PRODUCT.md`
  Corrects the stale Stage 4.8 spotlight status from “planned, not implemented” to “implemented, with #75 remaining as a performance follow-up.”

### Do Not Modify

- `packages/graph-engine/src/render/index.ts`
  It should already keep Sigma internals out of the public render barrel; tests will continue guarding this.

- `packages/graph-engine/src/render/sigma-graphology-model.ts`
  Already owns Graphology model helpers.

- `packages/graph-engine/src/render/sigma-hit-projector.ts`
  Already owns hit projector helpers.

- `packages/graph-engine/src/render/sigma-global-camera.ts`
  No #75 performance behavior in this plan.

- `README.md` and `CHANGELOG.md`
  This plan changes boundaries/tests/docs, not user-visible product behavior or a new feature list item.

## Task 0: Baseline And Branch Check

**Files:**
- Read: `docs/superpowers/specs/2026-06-30-sigma-global-subsystems-boundary-design.md`
- Read: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Read: `packages/graph-engine/test/sigma-global-renderer.test.ts`
- Read: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
- Read: `workbench/PRODUCT.md`

- [ ] **Step 1: Confirm branch**

Run:

```bash
git branch --show-current
git status --short --branch
```

Expected:

```text
codex/fix-sigma-global-boundaries
## codex/fix-sigma-global-boundaries
?? designs/community-drawer-visual-options/
?? designs/pr82-drawer-recovery/
?? tests/fixtures/graph-interactive-unified-drawer/
```

The three untracked paths are pre-existing and unrelated. Do not stage, edit, or delete them.

- [ ] **Step 2: Confirm the current leak before changing tests**

Run:

```bash
rg -n "export \\{|buildSigmaGlobalGraphologyGraph|createSigmaGlobalHitProjector|sigmaGlobalEdgeStyle" \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/test/sigma-global-renderer.test.ts
```

Expected: output includes these current facts:

```text
packages/graph-engine/src/render/sigma-global-renderer.ts:88:  buildSigmaGlobalGraphologyGraph,
packages/graph-engine/src/render/sigma-global-renderer.ts:89:  sigmaGlobalEdgeStyle
packages/graph-engine/src/render/sigma-global-renderer.ts:92:export { createSigmaGlobalHitProjector } from "./sigma-hit-projector";
packages/graph-engine/test/sigma-global-renderer.test.ts:9:  buildSigmaGlobalGraphologyGraph,
packages/graph-engine/test/sigma-global-renderer.test.ts:10:  createSigmaGlobalHitProjector,
packages/graph-engine/test/sigma-global-renderer.test.ts:12:  sigmaGlobalEdgeStyle,
```

- [ ] **Step 3: Run the existing focused baseline**

Run:

```bash
node --import tsx --test \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts \
  packages/graph-engine/test/renderer-boundary.test.ts \
  packages/graph-engine/test/architecture.test.ts \
  packages/graph-engine/test/sigma-global-renderer.test.ts \
  packages/graph-engine/test/sigma-graphology-model.test.ts \
  packages/graph-engine/test/sigma-hit-projector.test.ts \
  packages/graph-engine/test/sigma-overlay-dom.test.ts \
  packages/graph-engine/test/sigma-global-camera.test.ts \
  packages/graph-engine/test/sigma-wheel-zoom.test.ts \
  packages/graph-engine/test/sigma-zoom.test.ts \
  packages/graph-engine/test/sigma-coordinates.test.ts \
  packages/graph-engine/test/community-cloud-geometry.test.ts
```

Expected: PASS, with all tests passing. On the current branch this was 142 passing tests before the plan was written.

## Task 1: Strengthen Sigma Boundary Guard Tests

**Files:**
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
- Test: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`

- [ ] **Step 1: Replace the boundary test file with the stricter contract**

Replace the entire contents of `packages/graph-engine/test/sigma-refactor-boundaries.test.ts` with:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const renderDir = new URL("../src/render/", import.meta.url);

const rendererBoundaryExcludedFiles = new Set(["sigma-global-renderer.ts"]);
const existingTypeOnlyFiles = ["community-cloud-geometry.ts"];
const sigmaInternalModulesWithoutHostCallbacks = [
  "sigma-coordinates.ts",
  "sigma-events.ts",
  "sigma-global-camera.ts",
  "sigma-global-drag.ts",
  "sigma-graphology-model.ts",
  "sigma-hit-projector.ts",
  "sigma-overlay-dom.ts",
  "sigma-wheel-zoom.ts"
] as const;
const forbiddenRendererEntrypointReExportPatterns = [
  /export\s+\{\s*[\s\S]*?\bbuildSigmaGlobalGraphologyGraph\b[\s\S]*?\}\s+from\s+["']\.\/sigma-graphology-model["']/,
  /export\s+\{\s*[\s\S]*?\bsigmaGlobalEdgeStyle\b[\s\S]*?\}\s+from\s+["']\.\/sigma-graphology-model["']/,
  /export\s+\{\s*[\s\S]*?\bcreateSigmaGlobalHitProjector\b[\s\S]*?\}\s+from\s+["']\.\/sigma-hit-projector["']/,
  /export\s+type\s+\{\s*[\s\S]*?\bSigmaGlobalEdgeStyle\b[\s\S]*?\}\s+from\s+["']\.\/sigma-graphology-model["']/,
  /export\s+type\s+\{\s*[\s\S]*?\bSigmaGlobalHitInput\b[\s\S]*?\}\s+from\s+["']\.\/sigma-hit-projector["']/,
  /export\s+type\s+\{\s*[\s\S]*?\bSigmaGlobalHitProjector\b[\s\S]*?\}\s+from\s+["']\.\/sigma-hit-projector["']/,
  /export\s+type\s+\{\s*[\s\S]*?\bSigmaGlobalHitProjectorInput\b[\s\S]*?\}\s+from\s+["']\.\/sigma-hit-projector["']/,
  /export\s+type\s+\{\s*[\s\S]*?\bSigmaGlobalRenderedObject\b[\s\S]*?\}\s+from\s+["']\.\/sigma-hit-projector["']/
];
const forbiddenRendererTestImportPattern =
  /import\s+\{[\s\S]*?\b(?:buildSigmaGlobalGraphologyGraph|sigmaGlobalEdgeStyle|createSigmaGlobalHitProjector)\b[\s\S]*?\}\s+from\s+["']\.\.\/src\/render\/sigma-global-renderer["']/;
const forbiddenSigmaInternalHostIdentifiers = [
  "onOpenPage",
  "onSelectionChange",
  "onSelectionClear",
  "onSelectionInput",
  "onSelectionClearRequested",
  "onAsk",
  "persistPins",
  "onPinsChanged",
  "onHitTarget",
  "onDragActiveChange",
  "focusCommunity",
  "createGraphWorkbenchCapabilities",
  "createGraphOfflineCapabilities"
] as const;

describe("Sigma global renderer refactor boundaries", () => {
  it("keeps shared helper modules from importing the renderer", async () => {
    for (const file of [...await sigmaHelperFiles(), ...existingTypeOnlyFiles]) {
      const source = await readFile(new URL(`../src/render/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from\s+["']\.\/sigma-global-renderer(?:\.[jt]s)?["']/);
    }
  });

  it("keeps new Sigma internal helpers out of the render package barrel", async () => {
    const source = await readFile(new URL("../src/render/index.ts", import.meta.url), "utf8");
    for (const file of await sigmaHelperFiles()) {
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
    for (const pattern of forbiddenRendererEntrypointReExportPatterns) {
      assert.doesNotMatch(source, pattern);
    }
  });

  it("keeps renderer integration tests from importing internals through the renderer entrypoint", async () => {
    const source = await readFile(new URL("sigma-global-renderer.test.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, forbiddenRendererTestImportPattern);
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

async function sigmaHelperFiles(): Promise<string[]> {
  const entries = await readdir(renderDir);
  return entries
    .filter((file) => file.startsWith("sigma-") && file.endsWith(".ts"))
    .filter((file) => !rendererBoundaryExcludedFiles.has(file))
    .sort();
}
```

- [ ] **Step 2: Run the boundary test and verify it fails for the current leak**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL. The failure must mention at least one of:

```text
keeps the renderer entrypoint from re-exporting Sigma internal helpers
keeps renderer integration tests from importing internals through the renderer entrypoint
```

Do not change production code in this task.

## Task 2: Seal Renderer Internal Re-Exports And Move Test Imports

**Files:**
- Modify: `packages/graph-engine/test/sigma-global-renderer.test.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Test: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
- Test: `packages/graph-engine/test/sigma-global-renderer.test.ts`
- Test: `packages/graph-engine/test/sigma-graphology-model.test.ts`
- Test: `packages/graph-engine/test/sigma-hit-projector.test.ts`

- [ ] **Step 1: Move internal helper imports to their real modules**

In `packages/graph-engine/test/sigma-global-renderer.test.ts`, replace the current import block from `../src/render/sigma-global-renderer` with these three imports:

```ts
import {
  SIGMA_GLOBAL_RENDERER_BUNDLE_BOUNDARY,
  SIGMA_GLOBAL_RENDERER_ROUTE_MANAGER_OWNER,
  createSigmaGlobalRenderer,
  type SigmaGlobalGraphologyGraph,
  type SigmaGlobalRendererRuntime,
  type SigmaGlobalSigmaLike
} from "../src/render/sigma-global-renderer";
import {
  buildSigmaGlobalGraphologyGraph,
  sigmaGlobalEdgeStyle
} from "../src/render/sigma-graphology-model";
import { createSigmaGlobalHitProjector } from "../src/render/sigma-hit-projector";
```

The top of the file should then start like this:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import GraphologyGraph from "graphology";

import {
  SIGMA_GLOBAL_RENDERER_BUNDLE_BOUNDARY,
  SIGMA_GLOBAL_RENDERER_ROUTE_MANAGER_OWNER,
  createSigmaGlobalRenderer,
  type SigmaGlobalGraphologyGraph,
  type SigmaGlobalRendererRuntime,
  type SigmaGlobalSigmaLike
} from "../src/render/sigma-global-renderer";
import {
  buildSigmaGlobalGraphologyGraph,
  sigmaGlobalEdgeStyle
} from "../src/render/sigma-graphology-model";
import { createSigmaGlobalHitProjector } from "../src/render/sigma-hit-projector";
import type {
  GraphRendererAdapterData
} from "../src";
import { buildGraphRendererAdapterData } from "../src";
import type { GraphData } from "../src/types";
```

- [ ] **Step 2: Remove test-only internal re-exports from the renderer entrypoint**

In `packages/graph-engine/src/render/sigma-global-renderer.ts`, delete this block:

```ts
export {
  buildSigmaGlobalGraphologyGraph,
  sigmaGlobalEdgeStyle
} from "./sigma-graphology-model";
export type { SigmaGlobalEdgeStyle } from "./sigma-graphology-model";
export { createSigmaGlobalHitProjector } from "./sigma-hit-projector";
export type {
  SigmaGlobalHitInput,
  SigmaGlobalHitProjector,
  SigmaGlobalHitProjectorInput,
  SigmaGlobalRenderedObject
} from "./sigma-hit-projector";
```

Keep this public type export block intact:

```ts
export type {
  SigmaGlobalCameraState,
  SigmaGlobalGraphologyGraph,
  SigmaGlobalGraphologyRuntime,
  SigmaGlobalRenderer,
  SigmaGlobalRendererCreateOptions,
  SigmaGlobalRendererRuntime,
  SigmaGlobalRendererRuntimeBoundary,
  SigmaGlobalRendererUpdateOptions,
  SigmaGlobalSigmaLike
} from "./sigma-global-types";
```

Keep the existing imports from `sigma-graphology-model` and `sigma-hit-projector` at the top of the renderer file, because the renderer still uses those helpers internally.

- [ ] **Step 3: Run the focused tests and verify the new guard passes**

Run:

```bash
node --import tsx --test \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts \
  packages/graph-engine/test/sigma-global-renderer.test.ts \
  packages/graph-engine/test/sigma-graphology-model.test.ts \
  packages/graph-engine/test/sigma-hit-projector.test.ts
```

Expected: PASS.

- [ ] **Step 4: Confirm no remaining renderer-entrypoint internal helper imports**

Run:

```bash
rg -n "from \"\\.\\./src/render/sigma-global-renderer\"|from \"\\./render/sigma-global-renderer\"|from \"\\.\\/sigma-global-renderer\"" \
  packages/graph-engine/test packages/graph-engine/src \
  | rg "buildSigmaGlobalGraphologyGraph|createSigmaGlobalHitProjector|sigmaGlobalEdgeStyle|SigmaGlobalHitProjector|SigmaGlobalHitInput|SigmaGlobalRenderedObject|SigmaGlobalEdgeStyle" || true
```

Expected: no output.

- [ ] **Step 5: Commit the boundary guard and export cleanup**

Run:

```bash
git add \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts \
  packages/graph-engine/test/sigma-global-renderer.test.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts
git commit -m "test(graph): seal sigma global internal boundaries"
```

Expected: commit succeeds.

## Task 3: Correct Product Documentation For Implemented Spotlight

**Files:**
- Modify: `workbench/PRODUCT.md`

- [ ] **Step 1: Confirm the stale status exists**

Run:

```bash
rg -n "阶段 4\\.8：图谱演进——全局社区高亮|实现未启动|设计已定，待实现|待实现" workbench/PRODUCT.md
```

Expected: output includes both Stage 4.8 sections with stale “待实现” / “实现未启动” wording.

- [ ] **Step 2: Update the first Stage 4.8 section**

In `workbench/PRODUCT.md`, replace the first Stage 4.8 heading and status block:

```md
### 阶段 4.8：图谱演进——全局社区高亮（spotlight）🚧 设计已定，待实现

**背景**：4.7 把全局图统一成“一张有相机的地图”后，作者实测发现点社区后地图本身几乎没有反馈——用户只能靠右抽屉理解选择，图谱区像静态背景。缺的是“我正在看这个社区”的全局态。

**当前状态**：设计稿 `docs/spark/2026-06-26-global-sigma-community-spotlight-design.md` 已成稿（经两轮审查 + 修订），实现未启动。
```

with:

```md
### 阶段 4.8：图谱演进——全局社区高亮（spotlight）✅ 已完成 2026-06-27

**背景**：4.7 把全局图统一成“一张有相机的地图”后，点社区需要地图本身给出“我正在看这个社区”的反馈，而不是只依赖右抽屉解释选择。

**当前状态**：已落地。全局 Sigma 点社区会停留在全局路线并进入社区高亮态，右抽屉继续负责摘要与动作；相机轻量动画也已接入。#75 记录的是后续动画流畅度优化，不影响本阶段功能完成状态。
```

Keep the existing scope bullets after this block, but update the camera bullet from:

```md
- 相机轻量构图动画（平移 + 受限缩放，不重排不重算布局），连点立即打断旧动画。
```

to:

```md
- 相机轻量构图动画（平移 + 受限缩放）；#75 后续优化动画期间 overlay 重排成本。
```

- [ ] **Step 3: Update the summary Stage 4.8 section**

In the later summary section of `workbench/PRODUCT.md`, replace:

```md
### 阶段 4.8：图谱演进——全局社区高亮（spotlight）🚧 设计已定，待实现

**当前状态**：设计稿已成稿（两轮审查 + 修订），实现未启动。点社区在全局高亮、不进入；复用现有 selection（社区）视觉链路补节点弱化 + 相机动画，不复用 `focus`、不新增平行状态。
```

with:

```md
### 阶段 4.8：图谱演进——全局社区高亮（spotlight）✅ 已完成 2026-06-27

**当前状态**：已落地。点社区在全局高亮、不进入社区视图；复用现有 selection（社区）视觉链路补节点弱化 + 相机动画，不复用 `focus`、不新增平行状态。#75 继续跟进动画流畅度。
```

- [ ] **Step 4: Verify stale wording is gone from Stage 4.8**

Run:

```bash
rg -n "阶段 4\\.8：图谱演进——全局社区高亮|实现未启动|设计已定，待实现|待实现|#75" workbench/PRODUCT.md
```

Expected: output shows Stage 4.8 headings as completed and references #75 as a follow-up. It must not show “实现未启动” or “设计已定，待实现” for Stage 4.8.

- [ ] **Step 5: Commit the product doc correction**

Run:

```bash
git add workbench/PRODUCT.md
git commit -m "docs: correct sigma spotlight status"
```

Expected: commit succeeds.

## Task 4: Full Targeted Verification

**Files:**
- Verify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
- Verify: `packages/graph-engine/test/renderer-boundary.test.ts`
- Verify: `packages/graph-engine/test/architecture.test.ts`
- Verify: `packages/graph-engine/test/sigma-global-renderer.test.ts`
- Verify: `packages/graph-engine/test/sigma-graphology-model.test.ts`
- Verify: `packages/graph-engine/test/sigma-hit-projector.test.ts`
- Verify: `packages/graph-engine/test/sigma-overlay-dom.test.ts`
- Verify: `packages/graph-engine/test/sigma-global-camera.test.ts`
- Verify: `packages/graph-engine/test/sigma-wheel-zoom.test.ts`
- Verify: `packages/graph-engine/test/sigma-zoom.test.ts`
- Verify: `packages/graph-engine/test/sigma-coordinates.test.ts`
- Verify: `packages/graph-engine/test/community-cloud-geometry.test.ts`
- Verify: `install.sh`
- Verify: `scripts/`
- Verify: `templates/`
- Verify: `tests/`
- Verify: `SKILL.md`

- [ ] **Step 1: Run the Sigma boundary and module test set**

Run:

```bash
node --import tsx --test \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts \
  packages/graph-engine/test/renderer-boundary.test.ts \
  packages/graph-engine/test/architecture.test.ts \
  packages/graph-engine/test/sigma-global-renderer.test.ts \
  packages/graph-engine/test/sigma-graphology-model.test.ts \
  packages/graph-engine/test/sigma-hit-projector.test.ts \
  packages/graph-engine/test/sigma-overlay-dom.test.ts \
  packages/graph-engine/test/sigma-global-camera.test.ts \
  packages/graph-engine/test/sigma-wheel-zoom.test.ts \
  packages/graph-engine/test/sigma-zoom.test.ts \
  packages/graph-engine/test/sigma-coordinates.test.ts \
  packages/graph-engine/test/community-cloud-geometry.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the graph-engine package tests**

Run:

```bash
npm run test -w @llm-wiki/graph-engine
```

Expected: PASS.

- [ ] **Step 3: Run typecheck because renderer exports changed**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run install dry-run**

Run:

```bash
bash install.sh --dry-run --platform codex
```

Expected: PASS.

- [ ] **Step 5: Run privacy grep**

Run:

```bash
grep -r '本机用户路径\|真实姓名\|私有素材路径' scripts/ templates/ tests/ SKILL.md
```

Expected: no output and exit code 1. If the shell reports exit code 1 because there were no matches, that is the desired result.

- [ ] **Step 6: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 7: Confirm no unrelated untracked files were staged**

Run:

```bash
git status --short --branch
```

Expected: branch is `codex/fix-sigma-global-boundaries`. The only untracked paths should still be:

```text
?? designs/community-drawer-visual-options/
?? designs/pr82-drawer-recovery/
?? tests/fixtures/graph-interactive-unified-drawer/
```

There should be no unstaged changes in files touched by this plan.

## Task 5: Prepare PR Notes

**Files:**
- No file changes required unless the implementation process produces a local test report.

- [ ] **Step 1: Summarize the commits**

Run:

```bash
git log --oneline origin/main..HEAD
```

Expected: output includes:

```text
docs: design sigma global subsystem boundaries
test(graph): seal sigma global internal boundaries
docs: correct sigma spotlight status
```

- [ ] **Step 2: Prepare the PR summary**

Use this PR body:

```md
## Summary
- Documented the Sigma global subsystem boundary and test-layering contract for #79.
- Sealed the renderer entrypoint so internal Graphology and hit-projector helpers are tested through their real modules instead of renderer re-exports.
- Strengthened boundary tests for renderer exports, renderer test imports, helper dependency direction, render barrel drift, type-only shared types, and host-callback ownership.
- Corrected PRODUCT.md so Stage 4.8 spotlight is marked implemented, with #75 left as the follow-up performance issue.

## Verification
- [ ] `node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts packages/graph-engine/test/renderer-boundary.test.ts packages/graph-engine/test/architecture.test.ts packages/graph-engine/test/sigma-global-renderer.test.ts packages/graph-engine/test/sigma-graphology-model.test.ts packages/graph-engine/test/sigma-hit-projector.test.ts packages/graph-engine/test/sigma-overlay-dom.test.ts packages/graph-engine/test/sigma-global-camera.test.ts packages/graph-engine/test/sigma-wheel-zoom.test.ts packages/graph-engine/test/sigma-zoom.test.ts packages/graph-engine/test/sigma-coordinates.test.ts packages/graph-engine/test/community-cloud-geometry.test.ts`
- [ ] `npm run test -w @llm-wiki/graph-engine`
- [ ] `npm run typecheck`
- [ ] `bash install.sh --dry-run --platform codex`
- [ ] privacy keyword grep
- [ ] `git diff --check`

## Scope
Closes #79. Does not implement #75 performance changes.
```

- [ ] **Step 3: Do not open the PR until the user asks to ship**

This plan ends after verification and PR notes. Pushing and PR creation should use the project ship workflow only when the user asks to ship or create the PR.

## Self-Review

### Spec coverage

- Subsystem boundary documentation: covered by the already committed design doc and preserved in Task 5 PR summary.
- Test layering: covered by the design doc and Task 4 verification matrix.
- Boundary guards: Task 1 and Task 2.
- Remove test-only renderer helper exports: Task 2.
- Move renderer tests to real helper modules: Task 2.
- PRODUCT.md stale spotlight status: Task 3.
- #75 kept separate: Task 3 and Task 5.
- No user-visible behavior changes: Task 4 runs tests/typecheck; no runtime behavior edits are planned.

### Placeholder scan

The plan contains no placeholder markers and no open-ended implementation instructions.

### Type consistency

- Internal Graphology helpers stay in `sigma-graphology-model.ts`.
- Hit projector helpers stay in `sigma-hit-projector.ts`.
- Public renderer lifecycle types stay in `sigma-global-types.ts` and continue re-exporting through `sigma-global-renderer.ts`.
- Test commands use Node `node --test` with `tsx`, matching the repo convention.
