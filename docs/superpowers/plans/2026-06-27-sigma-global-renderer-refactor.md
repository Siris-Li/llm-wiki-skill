# Sigma Global Renderer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `sigma-global-renderer.ts` into stable Sigma global submodules without changing user-visible graph behavior.

**Architecture:** Keep `createSigmaGlobalRenderer` as the lifecycle orchestration entrypoint. Move Sigma types/events, Graphology render model, hit projection, camera logic, wheel zoom ownership, and overlay DOM ownership into focused internal modules that are not exported from the public package barrel.

**Tech Stack:** TypeScript ESM, Node `node:test`, Graphology, Sigma, existing graph-engine fake runtime tests.

---

## Scope Check

This plan implements only #77. It does not implement #79 or #80, and it does not fix #70, #74, #75, #71, or #72. The expected behavior after every task is unchanged graph behavior with a smaller, clearer Sigma global renderer entrypoint.

## File Structure

### Create

- `packages/graph-engine/src/render/sigma-global-types.ts`
  Shared Sigma global runtime and renderer TypeScript types only. No runtime code.

- `packages/graph-engine/src/render/sigma-events.ts`
  Stateless event payload helpers shared by wheel, drag, and hit handling.

- `packages/graph-engine/src/render/sigma-graphology-model.ts`
  Graphology graph construction, attribute mapping, edge styling, patch checks, and patch application.

- `packages/graph-engine/src/render/sigma-hit-projector.ts`
  Hit projector and Sigma event payload translation to `GraphGestureTarget`.

- `packages/graph-engine/src/render/sigma-global-camera.ts`
  Camera state read/restore/reset, community spotlight camera target, and reduced-motion camera movement.

- `packages/graph-engine/src/render/sigma-wheel-zoom.ts`
  Sigma mouse captor wheel binding, wheel payload parsing, zoom-control exclusion, viewport-center fallback, and cleanup.

- `packages/graph-engine/src/render/sigma-overlay-dom.ts`
  Overlay DOM controller for rebuild/reposition/destroy of community regions, node hit targets, and community labels.

- `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
  Internal boundary test for helper existence, no runtime import cycles back to `sigma-global-renderer`, and no package-barrel export drift.

### Modify

- `packages/graph-engine/src/render/sigma-global-renderer.ts`
  Keep lifecycle orchestration and public direct-source re-exports needed by existing tests. Remove moved implementation details.

- `packages/graph-engine/src/render/sigma-coordinates.ts`
  Import shared types from `sigma-global-types.ts` instead of `sigma-global-renderer.ts`.

- `packages/graph-engine/src/render/community-cloud-geometry.ts`
  Import shared Sigma-like types from `sigma-global-types.ts` instead of `sigma-global-renderer.ts`.

- `packages/graph-engine/src/render/index.ts`
  Should not export the new helper modules.

- `packages/graph-engine/test/sigma-global-renderer.test.ts`
  Keep integration/lifecycle tests. Direct model/camera/wheel behavior remains covered here unless a task explicitly creates a dedicated test file.

## Task 0: Branch And Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-06-27-sigma-global-renderer-refactor-design.md`
- Read: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Read: `packages/graph-engine/test/sigma-global-renderer.test.ts`

- [ ] **Step 1: Confirm implementation branch**

Run:

```bash
current_branch="$(git branch --show-current)"
if [ "$current_branch" != "codex/refactor-sigma-global-renderer-boundaries" ]; then
  git switch codex/refactor-sigma-global-renderer-boundaries
fi
git branch --show-current
```

Expected output:

```text
codex/refactor-sigma-global-renderer-boundaries
```

- [ ] **Step 2: Confirm clean working tree**

Run:

```bash
git status --short --branch
```

Expected:

```text
## codex/refactor-sigma-global-renderer-boundaries
```

- [ ] **Step 3: Run baseline targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: both commands pass before refactoring.

- [ ] **Step 4: Commit is not needed**

No files should change in Task 0. Do not commit.

## Task 1: Extract Shared Types And Event Helpers

**Files:**
- Create: `packages/graph-engine/src/render/sigma-global-types.ts`
- Create: `packages/graph-engine/src/render/sigma-events.ts`
- Create: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/src/render/sigma-coordinates.ts`
- Modify: `packages/graph-engine/src/render/community-cloud-geometry.ts`

- [ ] **Step 1: Write failing boundary test**

Create `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts"
];

describe("Sigma global renderer refactor boundaries", () => {
  it("keeps shared helper modules from importing the renderer runtime", async () => {
    for (const file of helperFiles) {
      const source = await readFile(new URL(`../src/render/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /from\s+["']\.\/sigma-global-renderer["']/);
    }
  });

  it("keeps new Sigma internal helpers out of the render package barrel", async () => {
    const source = await readFile(new URL("../src/render/index.ts", import.meta.url), "utf8");
    for (const file of helperFiles) {
      const moduleName = file.replace(/\.ts$/, "");
      assert.doesNotMatch(source, new RegExp(`["']\\\\./${moduleName}["']`));
    }
  });
});
```

- [ ] **Step 2: Run boundary test and verify it fails**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL because `sigma-global-types.ts` and `sigma-events.ts` do not exist yet.

- [ ] **Step 3: Create `sigma-global-types.ts`**

Create `packages/graph-engine/src/render/sigma-global-types.ts` by moving these type declarations out of `sigma-global-renderer.ts`:

```ts
import type { GraphEdgeStyleOptions, PinMap, ThemeId } from "../types";
import type { GraphRendererAdapterData } from "./adapter";
import type { GraphScreenPoint } from "./geometry";
import type { GraphGestureTarget } from "./gestures";
import type { RendererViewport, RendererViewportSize } from "./viewport";

export interface SigmaGlobalRendererRuntimeBoundary {
  Sigma: typeof import("sigma").default;
  GraphologyGraph: typeof import("graphology").default;
}

export type SigmaGlobalGraphologyGraph = InstanceType<SigmaGlobalRendererRuntimeBoundary["GraphologyGraph"]>;

export interface SigmaGlobalCameraState {
  x: number;
  y: number;
  angle: number;
  ratio: number;
}

export interface SigmaGlobalCameraLike {
  getState?: () => SigmaGlobalCameraState;
  setState?: (state: Partial<SigmaGlobalCameraState>) => unknown;
  isAnimated?: () => boolean;
  animate?: (
    state: Partial<SigmaGlobalCameraState>,
    options?: { duration?: number; easing?: string }
  ) => unknown;
}

export interface SigmaGlobalMouseCaptorLike {
  on?: (event: "wheel", listener: (payload?: unknown) => void) => unknown;
  off?: (event: "wheel", listener: (payload?: unknown) => void) => unknown;
}

export interface SigmaGlobalSigmaLike {
  getCamera?: () => SigmaGlobalCameraLike;
  getMouseCaptor?: () => SigmaGlobalMouseCaptorLike;
  getViewportZoomedState?: (viewportTarget: GraphScreenPoint, newRatio: number) => SigmaGlobalCameraState;
  getGraph?: () => unknown;
  setGraph?: (graph: SigmaGlobalGraphologyGraph) => unknown;
  getSetting?: (key: string) => unknown;
  setSetting?: (key: string, value: unknown) => unknown;
  viewportToGraph?: (point: GraphScreenPoint) => { x: number; y: number };
  viewportToFramedGraph?: (point: GraphScreenPoint) => { x: number; y: number };
  graphToViewport?: (point: { x: number; y: number }) => GraphScreenPoint;
  refresh?: () => unknown;
  on?: (event: string, listener: (payload?: unknown) => void) => unknown;
  off?: (event: string, listener: (payload?: unknown) => void) => unknown;
  kill?: () => unknown;
}

export interface SigmaGlobalGraphologyRuntime {
  GraphologyGraph: SigmaGlobalRendererRuntimeBoundary["GraphologyGraph"];
}

export interface SigmaGlobalRendererRuntime extends SigmaGlobalGraphologyRuntime {
  Sigma: new (graph: SigmaGlobalGraphologyGraph, container: HTMLElement, settings?: Record<string, unknown>) => SigmaGlobalSigmaLike;
}

export interface SigmaGlobalRendererCreateOptions {
  container: HTMLElement;
  adapterData: GraphRendererAdapterData;
  theme: ThemeId;
  edgeStyle?: GraphEdgeStyleOptions;
  onHitTarget?: (target: GraphGestureTarget) => void;
  onPinsChanged?: (pins: PinMap) => void;
  onDragActiveChange?: (dragging: boolean) => void;
  onFatalError?: (error: unknown) => void;
  pins?: PinMap;
  runtime?: SigmaGlobalRendererRuntime;
  viewport?: RendererViewport;
  viewportSize?: RendererViewportSize;
}

export interface SigmaGlobalRendererUpdateOptions {
  adapterData: GraphRendererAdapterData;
  theme?: ThemeId;
  edgeStyle?: GraphEdgeStyleOptions;
  pins?: PinMap;
}

export interface SigmaGlobalRenderer {
  readonly id: "sigma-global";
  readonly root: HTMLElement;
  readonly overlayRoot: HTMLElement;
  readonly graph: SigmaGlobalGraphologyGraph;
  readonly updateStrategy: "rebuild-graph-preserve-camera";
  readonly lastHitTarget: GraphGestureTarget | null;
  isDragging(): boolean;
  resetView(): void;
  zoomIn(): void;
  zoomOut(): void;
  update(options: SigmaGlobalRendererUpdateOptions): void;
  destroy(): void;
}
```

- [ ] **Step 4: Create `sigma-events.ts`**

Create `packages/graph-engine/src/render/sigma-events.ts`:

```ts
export interface SigmaGlobalPointerEventPayload {
  node?: unknown;
  event?: { x?: unknown; y?: unknown; preventSigmaDefault?: () => void };
  x?: unknown;
  y?: unknown;
  preventSigmaDefault?: () => void;
}

export function preventSigmaDefault(payload: unknown): void {
  const eventPayload = payload as SigmaGlobalPointerEventPayload | null;
  eventPayload?.preventSigmaDefault?.();
  eventPayload?.event?.preventSigmaDefault?.();
  if (payload instanceof Event) payload.preventDefault();
}
```

- [ ] **Step 5: Update imports and re-exports**

In `sigma-global-renderer.ts`, remove the moved type/interface declarations and add imports:

```ts
import type {
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
import { preventSigmaDefault } from "./sigma-events";

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

In `sigma-coordinates.ts`, change the type import to:

```ts
import type { SigmaGlobalRendererCreateOptions, SigmaGlobalSigmaLike } from "./sigma-global-types";
```

In `community-cloud-geometry.ts`, change the type import to:

```ts
import type { SigmaGlobalRendererCreateOptions, SigmaGlobalSigmaLike } from "./sigma-global-types";
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: all pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/graph-engine/src/render/sigma-global-types.ts \
  packages/graph-engine/src/render/sigma-events.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/src/render/sigma-coordinates.ts \
  packages/graph-engine/src/render/community-cloud-geometry.ts \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts
git commit -m "refactor(graph): extract sigma global shared types and events"
```

## Task 2: Extract Graphology Render Model

**Files:**
- Create: `packages/graph-engine/src/render/sigma-graphology-model.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`

- [ ] **Step 1: Extend boundary test**

Add `"sigma-graphology-model.ts"` to `helperFiles` in `sigma-refactor-boundaries.test.ts`:

```ts
const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts",
  "sigma-graphology-model.ts"
];
```

- [ ] **Step 2: Run boundary test and verify it fails**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL because `sigma-graphology-model.ts` does not exist yet.

- [ ] **Step 3: Create `sigma-graphology-model.ts`**

Create `packages/graph-engine/src/render/sigma-graphology-model.ts` by moving these exact declarations and functions out of `sigma-global-renderer.ts`:

```text
SigmaGlobalGraphologyNodeAttributes
SigmaGlobalGraphologyEdgeAttributes
SigmaGlobalGraphologyCommunityAttributes
SigmaGlobalGraphologyAggregationAttributes
SigmaGlobalEdgeStyle
buildSigmaGlobalGraphologyGraph
canPatchSigmaGlobalGraphAttributes
patchSigmaGlobalGraphAttributes
sigmaGlobalNodeAttributes
sigmaSelectedCommunityIds
sigmaSpotlightCommunityIds
sigmaSpotlightCommunityId
sigmaGlobalNodeSpotlightState
sigmaGlobalEdgeAttributes
sigmaGlobalEdgeStyle
sigmaGlobalEdgeRelationColor
rgbaColor
sigmaGlobalCommunityAttributes
sigmaGlobalAggregationAttributes
sigmaGlobalNodeSize
sigmaOverlayNodes
sigmaGlobalNodeColor
finiteNumber
clamp
roundNumber
```

Use these imports at the top of the new file:

```ts
import type { GraphEdgeStyleOptions, ThemeId } from "../types";
import type {
  GraphRendererAdapterAggregation,
  GraphRendererAdapterCommunity,
  GraphRendererAdapterData,
  GraphRendererAdapterEdge,
  GraphRendererAdapterNode
} from "./adapter";
import { edgeRelationClass } from "./model";
import { getThemeTokens } from "../themes";
import type { SigmaGlobalGraphologyGraph, SigmaGlobalGraphologyRuntime } from "./sigma-global-types";
```

Export `SIGMA_GLOBAL_NODE_HIT_TARGET_LIMIT` because `sigma-overlay-dom.ts` consumes it in Task 6:

```ts
export const SIGMA_GLOBAL_NODE_HIT_TARGET_LIMIT = 160;
```

- [ ] **Step 4: Update renderer imports and re-exports**

In `sigma-global-renderer.ts`, import model functions:

```ts
import {
  buildSigmaGlobalGraphologyGraph,
  canPatchSigmaGlobalGraphAttributes,
  patchSigmaGlobalGraphAttributes,
  sigmaGlobalNodeSize,
  sigmaOverlayNodes,
  sigmaSelectedCommunityIds,
  sigmaSpotlightCommunityId,
  sigmaSpotlightCommunityIds,
  sigmaGlobalNodeSpotlightState,
  sigmaGlobalEdgeStyle,
  type SigmaGlobalEdgeStyle
} from "./sigma-graphology-model";
```

Keep direct-source compatibility for existing tests:

```ts
export {
  buildSigmaGlobalGraphologyGraph,
  sigmaGlobalEdgeStyle
} from "./sigma-graphology-model";
export type { SigmaGlobalEdgeStyle } from "./sigma-graphology-model";
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: all pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/graph-engine/src/render/sigma-graphology-model.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts
git commit -m "refactor(graph): extract sigma graphology render model"
```

## Task 3: Extract Hit Projector

**Files:**
- Create: `packages/graph-engine/src/render/sigma-hit-projector.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`

- [ ] **Step 1: Extend boundary test**

Add `"sigma-hit-projector.ts"` to `helperFiles`:

```ts
const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts",
  "sigma-graphology-model.ts",
  "sigma-hit-projector.ts"
];
```

- [ ] **Step 2: Run boundary test and verify it fails**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL because `sigma-hit-projector.ts` does not exist yet.

- [ ] **Step 3: Create `sigma-hit-projector.ts`**

Create `packages/graph-engine/src/render/sigma-hit-projector.ts` by moving these declarations and functions out of `sigma-global-renderer.ts`:

```text
SigmaGlobalHitInput
SigmaGlobalHitProjectorInput
SigmaGlobalHitProjector
createSigmaGlobalHitProjector
sigmaNodeIdFromPayload
sigmaScreenPointFromPayload
spatialInputFromAdapterData
```

Use these imports:

```ts
import { createGraphSpatialIndex, type GraphSpatialIndex, type GraphSpatialIndexInput } from "../layout";
import type { GraphRendererAdapterData } from "./adapter";
import { screenPointToWorldPoint, type GraphScreenPoint } from "./geometry";
import { graphSpatialHitToGestureTarget, type GraphGestureTarget } from "./gestures";
import type { RendererViewport, RendererViewportSize } from "./viewport";
import {
  gestureTargetFromSigmaRenderedObject,
  type SigmaGlobalRenderedObject
} from "./sigma-global-drag";
```

- [ ] **Step 4: Update renderer imports and re-exports**

In `sigma-global-renderer.ts`, import:

```ts
import {
  createSigmaGlobalHitProjector,
  sigmaNodeIdFromPayload,
  sigmaScreenPointFromPayload,
  type SigmaGlobalHitInput,
  type SigmaGlobalHitProjector
} from "./sigma-hit-projector";
```

Keep direct-source compatibility:

```ts
export { createSigmaGlobalHitProjector } from "./sigma-hit-projector";
export type {
  SigmaGlobalHitInput,
  SigmaGlobalHitProjector,
  SigmaGlobalHitProjectorInput
} from "./sigma-hit-projector";
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: all pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/graph-engine/src/render/sigma-hit-projector.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts
git commit -m "refactor(graph): extract sigma hit projector"
```

## Task 4: Extract Camera Logic

**Files:**
- Create: `packages/graph-engine/src/render/sigma-global-camera.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`

- [ ] **Step 1: Extend boundary test**

Add `"sigma-global-camera.ts"` to `helperFiles`:

```ts
const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts",
  "sigma-graphology-model.ts",
  "sigma-hit-projector.ts",
  "sigma-global-camera.ts"
];
```

- [ ] **Step 2: Run boundary test and verify it fails**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL because `sigma-global-camera.ts` does not exist yet.

- [ ] **Step 3: Create `sigma-global-camera.ts`**

Create `packages/graph-engine/src/render/sigma-global-camera.ts` by moving these functions out of `sigma-global-renderer.ts`:

```text
readCameraState
restoreCameraState
maybeAnimateSigmaCommunitySpotlightCamera
moveSigmaCamera
sigmaCommunitySpotlightCameraState
sigmaGlobalCameraState
sigmaGraphPointToCameraPoint
sigmaCameraDistanceForGraphDistance
sigmaCommunitySpotlightCenter
prefersReducedMotion
finiteNumber
clamp
roundNumber
```

Use these imports:

```ts
import type { GraphRendererAdapterData } from "./adapter";
import {
  sigmaSpotlightCommunityId
} from "./sigma-graphology-model";
import type {
  SigmaGlobalCameraState,
  SigmaGlobalSigmaLike
} from "./sigma-global-types";
```

Export all moved camera functions that `sigma-global-renderer.ts` uses.

- [ ] **Step 4: Update renderer imports**

In `sigma-global-renderer.ts`, import:

```ts
import {
  maybeAnimateSigmaCommunitySpotlightCamera,
  readCameraState,
  restoreCameraState,
  sigmaGlobalCameraState,
  sigmaGraphPointToCameraPoint,
  prefersReducedMotion
} from "./sigma-global-camera";
```

Remove the moved function definitions from `sigma-global-renderer.ts`.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: all pass, including existing tests for community spotlight camera animation, reduced motion, already-framed community, and reset view.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/graph-engine/src/render/sigma-global-camera.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts
git commit -m "refactor(graph): extract sigma global camera logic"
```

## Task 5: Extract Wheel Zoom Controller

**Files:**
- Create: `packages/graph-engine/src/render/sigma-wheel-zoom.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`

- [ ] **Step 1: Extend boundary test**

Add `"sigma-wheel-zoom.ts"` to `helperFiles`:

```ts
const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts",
  "sigma-graphology-model.ts",
  "sigma-hit-projector.ts",
  "sigma-global-camera.ts",
  "sigma-wheel-zoom.ts"
];
```

- [ ] **Step 2: Run boundary test and verify it fails**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL because `sigma-wheel-zoom.ts` does not exist yet.

- [ ] **Step 3: Create `sigma-wheel-zoom.ts`**

Create `packages/graph-engine/src/render/sigma-wheel-zoom.ts`:

```ts
import type { GraphScreenPoint } from "./geometry";
import { preventSigmaDefault } from "./sigma-events";
import { sigmaWheelZoomRatio, type SigmaWheelDeltaLike } from "./sigma-zoom";
import type { SigmaGlobalSigmaLike } from "./sigma-global-types";

interface SigmaGlobalWheelPayload {
  x?: unknown;
  y?: unknown;
  delta?: unknown;
  original?: {
    deltaY?: unknown;
    deltaMode?: unknown;
    target?: unknown;
  };
  preventSigmaDefault?: () => void;
}

export interface SigmaWheelZoomController {
  destroy(): void;
}

export interface SigmaWheelZoomControllerInput {
  sigma: SigmaGlobalSigmaLike;
  root: HTMLElement;
  currentRatio: () => number;
  onZoomAtPoint: (point: GraphScreenPoint, nextRatio: number) => void;
}

export function bindSigmaWheelZoomController(input: SigmaWheelZoomControllerInput): SigmaWheelZoomController {
  const captor = input.sigma.getMouseCaptor?.();
  if (!captor?.on) return { destroy: () => undefined };
  const listener = (payload?: unknown): void => {
    const wheel = sigmaWheelInputFromPayload(payload, sigmaViewportCenter(input.root));
    if (!wheel) return;
    preventSigmaDefault(payload);
    if (sigmaWheelTargetIsZoomControl(payload)) return;
    const nextRatio = sigmaWheelZoomRatio(input.currentRatio(), wheel.delta);
    input.onZoomAtPoint(wheel.point, nextRatio);
  };
  captor.on("wheel", listener);
  return {
    destroy() {
      captor.off?.("wheel", listener);
    }
  };
}

export function sigmaWheelInputFromPayload(payload: unknown, fallbackPoint: GraphScreenPoint): {
  point: GraphScreenPoint;
  delta: SigmaWheelDeltaLike;
} | null {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const originalDeltaY = wheel?.original?.deltaY;
  const fallbackDelta = wheel?.delta;
  const deltaY = typeof originalDeltaY === "number"
    ? originalDeltaY
    : typeof fallbackDelta === "number"
      ? -fallbackDelta * 120
      : null;
  if (deltaY == null || !Number.isFinite(deltaY)) return null;

  const x = finiteNumber(wheel?.x, Number.NaN);
  const y = finiteNumber(wheel?.y, Number.NaN);
  const point = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallbackPoint;
  const originalDeltaMode = wheel?.original?.deltaMode;
  return {
    point,
    delta: {
      deltaY,
      deltaMode: typeof originalDeltaMode === "number" ? originalDeltaMode : 0
    }
  };
}

export function sigmaWheelTargetIsZoomControl(payload: unknown): boolean {
  const wheel = payload as SigmaGlobalWheelPayload | null;
  const target = wheel?.original?.target as {
    closest?: (selector: string) => unknown;
    parentElement?: { closest?: (selector: string) => unknown };
  } | null | undefined;
  return Boolean(
    target?.closest?.("[data-control=\"sigma-zoom\"]") ||
    target?.parentElement?.closest?.("[data-control=\"sigma-zoom\"]")
  );
}

export function sigmaViewportCenter(root: HTMLElement): GraphScreenPoint {
  const rect = typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect() : null;
  const width = finiteNumber(rect?.width, 1000);
  const height = finiteNumber(rect?.height, 680);
  return {
    x: width / 2,
    y: height / 2
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
```

- [ ] **Step 4: Update renderer to use controller**

In `sigma-global-renderer.ts`:

1. Replace `sigmaWheelCleanup` with:

```ts
let sigmaWheelZoomController: { destroy(): void } | null = null;
```

2. Replace `bindSigmaWheelZoom()` call with:

```ts
sigmaWheelZoomController = bindSigmaWheelZoomController({
  sigma,
  root: sigmaRoot,
  currentRatio: () => readCameraState(sigma)?.ratio ?? 1,
  onZoomAtPoint: (point, nextRatio) => zoomSigmaCameraAtViewportPoint(point, nextRatio, false)
});
```

3. Replace `unbindSigmaWheelZoom()` call with:

```ts
sigmaWheelZoomController?.destroy();
sigmaWheelZoomController = null;
```

4. Import:

```ts
import {
  bindSigmaWheelZoomController,
  sigmaViewportCenter
} from "./sigma-wheel-zoom";
```

5. Remove local `SigmaGlobalWheelPayload`, `bindSigmaWheelZoom`, `unbindSigmaWheelZoom`, `handleSigmaWheelZoom`, `sigmaWheelInputFromPayload`, `sigmaWheelTargetIsZoomControl`, and `sigmaViewportCenter`.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
node --import tsx --test packages/graph-engine/test/sigma-zoom.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: all pass, including existing wheel zoom tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/graph-engine/src/render/sigma-wheel-zoom.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts
git commit -m "refactor(graph): extract sigma wheel zoom controller"
```

## Task 6: Extract Overlay DOM Controller

**Files:**
- Create: `packages/graph-engine/src/render/sigma-overlay-dom.ts`
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`

- [ ] **Step 1: Extend boundary test**

Add `"sigma-overlay-dom.ts"` to `helperFiles`:

```ts
const helperFiles = [
  "sigma-global-types.ts",
  "sigma-events.ts",
  "sigma-graphology-model.ts",
  "sigma-hit-projector.ts",
  "sigma-global-camera.ts",
  "sigma-wheel-zoom.ts",
  "sigma-overlay-dom.ts"
];
```

- [ ] **Step 2: Run boundary test and verify it fails**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: FAIL because `sigma-overlay-dom.ts` does not exist yet.

- [ ] **Step 3: Create overlay controller file**

Create `packages/graph-engine/src/render/sigma-overlay-dom.ts` with this exported controller shape:

```ts
import type { GraphRendererAdapterData } from "./adapter";
import type { GraphScreenPoint } from "./geometry";
import type { PinPosition } from "../types";
import type { SigmaCommunityCloud } from "./community-cloud-geometry";
import type { SigmaGlobalRenderedObject } from "./sigma-global-drag";
import type { SigmaGlobalRendererCreateOptions, SigmaGlobalSigmaLike } from "./sigma-global-types";

export interface SigmaOverlayDomController {
  rebuild(): void;
  reposition(): void;
  destroy(): void;
}

export interface SigmaOverlayDomControllerInput {
  overlayRoot: HTMLElement;
  cloudFilterId: string;
  getAdapterData: () => GraphRendererAdapterData;
  getSigma: () => SigmaGlobalSigmaLike;
  getOptions: () => Pick<SigmaGlobalRendererCreateOptions, "viewport" | "viewportSize" | "adapterData">;
  communityCloudFor: (communityId: string, wash: { cx: number; cy: number; rx: number; ry: number }) => SigmaCommunityCloud;
  isDestroyed: () => boolean;
  onHit: (object: SigmaGlobalRenderedObject) => void;
  beginNodeDrag: (nodeId: string, point: GraphScreenPoint, payload?: unknown) => void;
  moveNodeDrag: (point: GraphScreenPoint, payload?: unknown) => void;
  commitNodeDrag: (point: GraphScreenPoint | null, payload?: unknown) => void;
  cancelNodeDrag: () => void;
  consumeSuppressedNodeClick: (nodeId: string | null) => boolean;
  activeNodeDragId: () => string | null;
}
```

Then move these existing renderer functions and maps into the new file, adapting them to use `input.getAdapterData()`, `input.getSigma()`, and callbacks:

```text
overlayRegionEntries
overlayNodeEntries
overlayLabelEntries
rebuildSigmaOverlays
repositionSigmaOverlays
createSigmaNodeHitTarget
pruneOverlayEntries
overlayBoxFromWorldEllipse
bindOverlayPointerDragListeners
bindOverlayMouseDragListeners
isActiveOverlayDrag
clearOverlayPointerDragListeners
```

Keep the same behavior:

- `rebuild()` may call `replaceChildren`.
- `reposition()` must not call `replaceChildren`.
- `reposition()` must not create DOM elements.
- click handlers call `input.onHit(...)`.
- drag handlers call the passed drag callbacks.

- [ ] **Step 4: Update renderer to use overlay controller**

In `sigma-global-renderer.ts`:

1. Replace the three overlay maps and `overlayPointerDragCleanup` with:

```ts
let overlayDomController: SigmaOverlayDomController | null = null;
```

2. After Sigma is created, initialize the controller:

```ts
overlayDomController = createSigmaOverlayDomController({
  overlayRoot,
  cloudFilterId,
  getAdapterData: () => adapterData,
  getSigma: () => sigma,
  getOptions: () => ({ ...options, adapterData }),
  communityCloudFor: sigmaCommunityCloudFor,
  isDestroyed: () => destroyed,
  onHit: (renderedObject) => handleSigmaHit({ renderedObject }),
  beginNodeDrag,
  moveNodeDrag,
  commitNodeDrag,
  cancelNodeDrag,
  consumeSuppressedNodeClick,
  activeNodeDragId: () => activeNodeDrag?.nodeId ?? null
});
```

3. Replace calls:

```ts
rebuildSigmaOverlays();
repositionSigmaOverlays();
```

with:

```ts
overlayDomController?.rebuild();
overlayDomController?.reposition();
```

4. On destroy, call:

```ts
overlayDomController?.destroy();
overlayDomController = null;
```

5. Import:

```ts
import {
  createSigmaOverlayDomController,
  type SigmaOverlayDomController
} from "./sigma-overlay-dom";
```

6. Remove the moved local functions and maps.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
node --import tsx --test packages/graph-engine/test/sigma-global-renderer.test.ts
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: all pass, including tests that prove overlay elements are reused on camera updates and data updates.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/graph-engine/src/render/sigma-overlay-dom.ts \
  packages/graph-engine/src/render/sigma-global-renderer.ts \
  packages/graph-engine/test/sigma-refactor-boundaries.test.ts
git commit -m "refactor(graph): extract sigma overlay dom controller"
```

## Task 7: Final Cleanup And Verification

**Files:**
- Modify: `packages/graph-engine/src/render/sigma-global-renderer.ts`
- Modify: `packages/graph-engine/test/sigma-refactor-boundaries.test.ts`
- Read: `docs/superpowers/specs/2026-06-27-sigma-global-renderer-refactor-design.md`

- [ ] **Step 1: Check renderer no longer owns moved functions**

Run:

```bash
rg -n "function (readCameraState|restoreCameraState|maybeAnimateSigmaCommunitySpotlightCamera|sigmaWheelInputFromPayload|sigmaWheelTargetIsZoomControl|rebuildSigmaOverlays|repositionSigmaOverlays|buildSigmaGlobalGraphologyGraph|createSigmaGlobalHitProjector)" packages/graph-engine/src/render/sigma-global-renderer.ts
```

Expected: no matches.

- [ ] **Step 2: Check helper modules do not import renderer runtime**

Run:

```bash
node --import tsx --test packages/graph-engine/test/sigma-refactor-boundaries.test.ts
```

Expected: PASS.

- [ ] **Step 3: Check line count changed materially**

Run:

```bash
wc -l packages/graph-engine/src/render/sigma-global-renderer.ts
```

Expected: line count is significantly lower than 1570. Do not fail the task only on a numeric threshold; use it as a sanity check.

- [ ] **Step 4: Run graph-engine full verification**

Run:

```bash
npm run test -w @llm-wiki/graph-engine
npm run typecheck -w @llm-wiki/graph-engine
```

Expected: both pass.

- [ ] **Step 5: Run workbench smoke**

Run:

```bash
npm run dev
```

Then open the workbench and verify these paths manually:

```text
1. Open graph global view.
2. Wheel or trackpad zoom does not jump.
3. Left-bottom zoom buttons work.
4. Click a community: still stays in global graph, drawer opens, community is highlighted.
5. Click return-global: global composition returns.
6. Drag a node and release: pin behavior still works.
```

Expected: all paths behave like current main. If browser verification is blocked by port, Chrome, or local data, record the exact blocker in the final response and do not claim browser verification passed.

- [ ] **Step 6: Comment on #77**

Run:

```bash
gh issue comment 77 --repo sdyckjq-lab/llm-wiki-skill --body "Implemented the Sigma global renderer split from the design spec. Extracted shared Sigma types/events, Graphology render model, hit projector, camera logic, wheel zoom controller, and overlay DOM controller. Verified graph-engine tests/typecheck and browser smoke where available. PR will close this issue after review."
```

Expected: issue comment is created.

- [ ] **Step 7: Commit final cleanup**

If Step 1-6 changed files, run:

```bash
git add packages/graph-engine/src/render packages/graph-engine/test
git commit -m "test(graph): verify sigma renderer refactor boundaries"
```

If Step 1-6 did not change files, do not create an empty commit.

## Final Self-Review Checklist

- [ ] Spec coverage: every module from the design has a task.
- [ ] No helper imports `./sigma-global-renderer` at runtime.
- [ ] New helpers are not exported from `packages/graph-engine/src/render/index.ts`.
- [ ] `sigma-global-renderer.ts` still exports existing direct-source symbols used by tests.
- [ ] Existing graph-engine behavior tests pass.
- [ ] Browser smoke result is recorded honestly.
- [ ] #77 has an implementation comment.
