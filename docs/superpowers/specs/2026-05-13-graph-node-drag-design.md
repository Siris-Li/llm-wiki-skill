# Graph Node Drag Design

Date: 2026-05-13
Issue: https://github.com/sdyckjq-lab/llm-wiki-skill/issues/43
Status: Approved direction, design ready for review

## Summary

Add manual node dragging to the existing wash knowledge graph. Users can drag one visible node to reduce overlap or prepare a clearer presentation view. Connected edges follow the node while dragging. When the pointer is released, the new position is saved locally for that wiki and restored on the next page load.

This feature extends the current graph runtime. It does not replace the graph renderer, add a new graph library, or change `graph-data.json`.

## Context

The current graph already supports:

- A wash-only graph shell in `templates/graph-styles/wash/`.
- Node and edge rendering in `graph-wash.js`.
- Layout derivation and coordinate helpers in `graph-wash-helpers.js`.
- Canvas pan, wheel zoom, fit-to-view, minimap, filtering, search, selected-node reading state, and local queue storage.
- Per-wiki local storage namespacing through `getWikiStorageNamespace()` and `queueStorageKey()`.

Prior project notes matter for this design:

- `docs/solutions/developer-experience/graph-style-simplification-to-wash-only-2026-04-20.md` records that earlier vis-network attempts passed tests but produced poor graph readability. We should not reintroduce a separate graph renderer for this feature.
- `docs/plans/2026-04-23-learning-cockpit-global-reframe-plan.md` requires local storage keys to be isolated by wiki namespace.
- `docs/plans/2026-04-28-001-refactor-oriental-atlas-usability-plan.md` requires pan and zoom to update transforms without rebuilding the whole graph on every pointer event. Node drag should follow the same performance rule.
- `docs/solutions/ui-bugs/graph-wash-null-safety-and-label-truncation-fix-2026-04-21.md` recommends layered tests: static shell checks plus runtime behavior tests.

## External Research

The implementation should borrow patterns rather than code:

- React Flow / xyflow separates drag start, drag, and drag stop, and only finalizes position changes after drag stop. Its save-and-restore example stores the graph state in local storage and restores it later.
  - https://github.com/xyflow/xyflow
  - https://github.com/xyflow/web/blob/main/apps/example-apps/react/examples/interaction/save-and-restore/App.jsx
- vis-network exposes `getPositions()`, `storePositions()`, and `moveNode()`, which reinforces the pattern of treating node positions as first-class state.
  - https://github.com/visjs/vis-network
- Cytoscape.js exposes separate `drag`, `free`, and `dragfree` events, which reinforces saving after a completed drag rather than on every movement.
  - https://github.com/cytoscape/cytoscape.js
- D3 Drag provides low-level pointer abstraction for mouse and touch input. The current project should use native pointer events instead of adding a dependency, but follow the same event lifecycle.
  - https://github.com/d3/d3-drag

## Goals

1. Let users drag a single node in the visible graph.
2. Keep connected edges visually attached while dragging.
3. Save the final position only after drag ends.
4. Restore saved positions on reload for the same wiki only.
5. Provide a clear way to reset manual positions and return to automatic layout.
6. Keep click-to-select, pan, zoom, search, filtering, minimap, and drawer behavior intact.
7. Keep the generated graph self-contained and offline.

## Non-Goals

- Multi-node selection or group dragging.
- Editing graph relationships.
- Persisting positions back into markdown, `graph-data.json`, or repository files.
- Syncing positions across browsers or devices.
- Introducing React Flow, Cytoscape.js, vis-network, D3 Drag, or any new runtime dependency.
- Solving all dense graph layout issues automatically.

## User Experience

Users can drag a node directly from the canvas. A small movement threshold prevents accidental drag when the intent is to click. A click with no real movement still selects the node and opens the existing reading flow.

While dragging:

- The node follows the pointer.
- Connected edges update immediately.
- Canvas panning is suppressed for that pointer.
- The node receives a subtle dragging style: no transition, grab cursor, higher z-index, and slightly stronger shadow.

After release:

- The node model is updated.
- The manual position is saved to local storage.
- The minimap is refreshed.
- Existing selection and filter state remain unchanged.

The toolbar gains a `恢复布局` action. It clears saved manual positions for the current wiki, recomputes the automatic layout for the current graph data, and rerenders the current view.

## Data Model

Use the existing per-wiki local storage namespace:

```json
{
  "version": 1,
  "updated_at": "2026-05-13T00:00:00.000Z",
  "nodes": {
    "node-id": { "x": 42.5, "y": 61.25 }
  }
}
```

Rules:

- Store only manually moved nodes, not every node in the graph.
- Ignore saved entries whose node IDs no longer exist.
- Ignore invalid or non-finite coordinates.
- Clamp restored coordinates to the same safe atlas bounds used by automatic layout.
- If local storage is blocked or full, dragging still works for the current session but does not persist.

The key should be generated through the same namespace pattern as queue and neighbor state, for example `queueStorageKey("node-positions")`. That avoids the issue attachment's global `wiki-graph-dragged-positions` key, which can mix positions across different wikis.

## Runtime Design

### Layout Startup

Current startup builds the model, derives layout, then creates storage. This feature needs saved positions before final layout is derived.

The startup order should become:

1. Build the atlas model from graph data.
2. Create safe local storage.
3. Compute the wiki storage namespace.
4. Load and sanitize manual node positions for this wiki.
5. Derive atlas layout with those manual overrides.
6. Continue normal runtime initialization.

`deriveAtlasLayout()` should accept optional manual positions and apply them before automatic placement. This keeps the layout rule testable in helper tests.

### Pointer Lifecycle

Add a `nodeDragState` alongside the existing `panState`.

On pointer down over `.node`:

- Start a node drag candidate if the primary button is used and the node exists.
- Capture the pointer.
- Record pointer start, node start coordinates, viewport scale, and atlas dimensions.
- Do not select the node yet.

On pointer move:

- If movement has not crossed the threshold, do nothing.
- Once crossed, mark the drag as moved.
- Convert screen delta to atlas percent delta using current atlas dimensions and viewport scale.
- Update only the dragged node element style and connected edge paths.
- Prevent the canvas pan handler from taking over.

On pointer up or cancel:

- If the node moved, update the model position and save the override.
- Release pointer capture.
- Clear dragging CSS.
- Refresh the minimap.
- Suppress the following click selection only for completed drags.

### Coordinate Conversion

Do not use fixed constants like `10` and `6.8` for drag deltas. Drag conversion should be based on the actual canvas size:

- `deltaXPercent = clientDeltaX / (atlasWidth * viewportScale) * 100`
- `deltaYPercent = clientDeltaY / (atlasHeight * viewportScale) * 100`

Existing path generation can still use `atlasNodePoint()` and `makePath()`, because that is the graph's established model-to-SVG conversion.

### Edge Updates

During drag, update only paths connected to the dragged node:

- Find edge path elements by `data-from` and `data-to`.
- Use the temporary dragged coordinates for the moving node.
- Use model coordinates for the other endpoint.
- Recompute the path with the existing `makePath()` helper.

This avoids rebuilding node cards, drawer content, filters, and the entire edge layer on every pointer move.

### Reset Layout

Add a toolbar button:

- Label: `恢复布局`
- Behavior: clear the current wiki's saved node positions, recompute automatic positions from graph data, and rerender.
- Preserve current search, community, filter, and selected-node state as long as the selected node still exists.

## Error Handling

- Local storage read errors: log a warning through the existing safe storage path and continue with automatic layout.
- Invalid stored JSON: ignore it and continue with automatic layout.
- Missing node during drag: cancel the drag cleanly.
- Pointer cancel: remove dragging state and do not save.
- Window resize: existing rerender behavior remains; manual coordinates are model coordinates and should remain valid.

## Testing Plan

Unit/runtime tests:

- Helper test for applying manual positions during layout.
- Helper test for ignoring unknown nodes and invalid coordinates.
- Runtime storage test confirming manual positions use the same per-wiki namespace pattern as queue state.
- Runtime state test for drag threshold behavior: click remains click unless movement crosses the threshold.
- Runtime state test for edge path update against a dragged node.

Generated HTML regression tests:

- `knowledge-graph.html` includes the `恢复布局` control.
- `graph-wash.js` includes node drag setup and reset-layout handling.
- `graph-wash-helpers.js` exports any new pure helper needed for position normalization.

Manual/browser verification before shipping:

- Generate a fixture graph.
- Open the generated HTML.
- Drag a node and confirm connected lines follow.
- Refresh the page and confirm the dragged node stays put.
- Use `恢复布局` and confirm automatic layout returns.
- Confirm click-to-select still works.
- Confirm canvas pan, wheel zoom, minimap click, search, community filter, and right drawer still work.
- Check desktop and mobile-sized viewports for overlap and accidental drag behavior.

Repository pre-push checks remain required if implementation follows:

- `bash install.sh --dry-run --platform codex`
- Relevant graph regression scripts.
- Relevant `node --test tests/js/...` files.
- Privacy path grep required by `AGENTS.md`.

## Acceptance Criteria

The feature is done when:

1. A visible node can be dragged with mouse or pointer-compatible input.
2. Dragging updates connected edges in real time.
3. Dragging does not select the node unless the pointer did not move past the threshold.
4. Position changes persist after refresh for the same wiki.
5. Manual positions do not affect another wiki.
6. Reset layout clears saved manual positions for the current wiki.
7. Existing graph navigation and reading flows continue to pass tests and browser verification.
8. The implementation does not add a new graph dependency.

## Implementation Boundaries

Expected files:

- `templates/graph-styles/wash/graph-wash.js`
- `templates/graph-styles/wash/graph-wash-helpers.js`
- `templates/graph-styles/wash/header.html`
- `tests/js/graph-wash-runtime-state.test.js`
- `tests/js/graph-wash-helpers.test.js`
- `tests/graph-html-node-drag.regression-1.sh`

Documentation updates for implementation should be handled after the feature is coded and verified, following the repository's release documentation rules.
