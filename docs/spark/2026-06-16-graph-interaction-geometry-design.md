# Graph Interaction Geometry Design

Date: 2026-06-16

## Summary

The graph interaction bugs are not isolated pointer-handling mistakes. They come from one architectural gap: node placement, viewport transforms, pointer gestures, hover previews, community washes, and minimap state currently compute positions in different places with different assumptions.

This design introduces a dedicated graph interaction geometry layer. The goal is to make every position-sensitive behavior use one shared model:

- World position: where nodes, edges, and communities live in the graph model.
- Viewport/camera: how the user is currently looking at that world through pan and zoom.
- Screen position: where the user sees things and where the pointer is.
- Projection: the only allowed way to convert between world, layer, minimap, and screen spaces.
- Interaction rules: drag, wheel, pan, hover, and selection all use the same projection.

The implementation should not be a full graph rewrite. It should carve out the coordinate and interaction responsibilities from `packages/graph-engine/src/render/static-renderer.ts` and make them explicit, testable modules.

## Context

Product decisions already point in this direction:

- ADR-21 defines the graph as a living map with simulation and pinning.
- ADR-21 separates position from structure: dragging changes layout, not wikilink/community truth.
- ADR-22 defines canvas navigation as a foundation capability.
- Stage 4.6 makes local community focus the daily-use graph mode.

Recent fixes exposed the missing boundary:

- Wheel zoom over community washes needed special gesture target handling.
- Wheel zoom over nodes needed another target exception.
- Node dragging was fixed by adding viewport-aware pointer mapping, but this exposed two further problems:
  - Dragging can appear trapped inside the community wash because conversion/clamping is mixed into the wrong layer.
  - Hover previews drift because they still position themselves from pre-viewport node coordinates.

The common cause is not the community wash itself. The common cause is that interaction geometry is not centralized.

## Goals

1. All graph interactions use one coordinate model.
2. Node dragging follows the pointer under pan, zoom, drawer resize, and community focus.
3. Nodes can be dragged outside their community wash.
4. Community wash shapes can respond to dragged nodes, but cannot grow without bounds.
5. Hover previews follow the node's actual rendered position.
6. Wheel zoom behavior is consistent over blank canvas, nodes, and community washes.
7. Pointer panning, node dragging, node click, community click, and minimap interaction do not conflict.
8. The renderer becomes a composition layer instead of the owner of coordinate math.
9. The same engine behavior remains available to both the workbench graph and Skill/offline graph.

## Non-Goals

- Do not rewrite graph data generation.
- Do not change community membership semantics.
- Do not change relation edge color/typing rules.
- Do not redesign the drawer content model.
- Do not introduce a new rendering technology such as Canvas or WebGL.
- Do not add a new npm dependency.
- Do not implement free-form lasso selection.
- Do not change the knowledge-base pin storage format unless a compatibility shim proves necessary.

## Design Principle

The graph is a map with a camera.

Every position-aware feature must answer these questions explicitly:

1. Is this value in world space, viewport/layer space, screen space, or minimap space?
2. Which function converts it?
3. Which layer is allowed to clamp or constrain it?
4. Is this a structural fact, a layout choice, or temporary UI state?

If a function cannot answer those questions, it should not own coordinate math.

## Proposed Architecture

### 1. Viewport Module

Owns the camera state.

Responsibilities:

- Normalize viewport state.
- Pan viewport.
- Zoom viewport around a pointer.
- Fit world points into the current viewport.
- Center on a world point.
- Recompute viewport after host resize or drawer width change.
- Convert viewport state to DOM transform.
- Report the visible world rectangle for minimap and tests.

Rules:

- Viewport transforms move the camera, not the graph data.
- Opening the drawer can change the available viewport size, but cannot change node world positions.
- Viewport clamping is only about how far the user can pan the camera, not where nodes are allowed to move.

Expected file direction:

- Keep current viewport helpers in `packages/graph-engine/src/render/viewport.ts`.
- Expand it only for camera semantics.
- Move generic projection helpers to `geometry.ts` so `viewport.ts` does not become the new catch-all.

### 2. Geometry Module

Owns projection between spaces.

Responsibilities:

- World point to layer pixel.
- Layer pixel to world point.
- World point to screen point.
- Screen point to world point.
- World delta to layer delta.
- World bounds to screen/layer bounds.
- Minimap point to world point.
- World/viewport rectangle to minimap rectangle.
- DOM rect to local graph-screen point.

Rules:

- Geometry conversion functions must not silently clamp drag targets.
- If a conversion needs optional clamping for a UI case, the caller must opt in and the function name must make that obvious.
- Every consumer must pass the current viewport and viewport size explicitly.
- Hover previews, node drag, edge previews, minimap, and community washes must use this module.

Current bug prevention:

- A dragged pointer outside the current world rectangle should still produce a meaningful target for drag handling.
- Hover preview position should come from the node's actual projected position, not from `node.x` / `node.y` percentages alone.

Expected file direction:

- New file: `packages/graph-engine/src/render/geometry.ts`.
- Export through `packages/graph-engine/src/render/index.ts` only for tested public helpers.

### 3. Gestures Module

Owns interpretation of pointer and wheel events.

Responsibilities:

- Decide whether a wheel event should zoom the graph or be ignored for a UI control.
- Decide whether pointerdown starts blank-canvas pan, node drag, minimap interaction, or no graph gesture.
- Track drag threshold so click and drag do not conflict.
- Track node grab offset so the node does not snap to its center.
- Route node drag targets through Geometry and Simulation Bridge.
- Route blank pan deltas through Viewport.
- Handle double-click reset.

Rules:

- Nodes and community washes allow wheel zoom to pass through to the viewport.
- Nodes block blank-canvas panning because pointer drag means node drag.
- Community washes block blank-canvas panning/click only when the interaction is selecting a community; they must not block wheel zoom.
- Search, toolbar, drawer, legend, minimap, and text editing controls block graph gestures unless that control explicitly owns a graph gesture.

Expected file direction:

- New file: `packages/graph-engine/src/render/gestures.ts`.
- `static-renderer.ts` wires DOM elements to gesture handlers but does not implement gesture math.

### 4. Overlays Module

Owns floating UI placement and community visual shapes.

Responsibilities:

- Position hover preview near the node's actual screen position.
- Position edge hover preview near the projected edge midpoint.
- Keep hover previews inside the available graph viewport.
- Reposition previews when viewport changes, graph positions change, drawer width changes, or density mode changes.
- Compute community wash shapes from current world positions.
- Apply bounded community wash deformation.

Rules:

- Hover preview is UI overlay, not graph content. It should not scale with the graph content layer.
- Hover preview must not change world position or pin state.
- Community wash is a visual region for community membership, not a hard drag boundary.
- Community wash can stretch, but one far dragged node cannot make it consume the whole canvas.

Expected file direction:

- New file: `packages/graph-engine/src/render/overlays.ts`.
- Move `positionHoverPreview`, `positionEdgeHoverPreview`, and community wash geometry helpers into focused helpers.
- Keep visual styles in the renderer CSS for now.

### 5. Simulation Bridge

Owns the boundary between UI drag and force simulation.

Responsibilities:

- Start drag with current node world position.
- Apply drag target world position.
- Preserve pointer grab offset.
- Let nearby nodes respond according to the existing low-heat simulation.
- Freeze far nodes while dragging, as today.
- End drag and persist pin.
- Unpin on double-click.

Rules:

- Simulation should receive world-space target positions.
- Simulation may constrain graph layout only where layout rules require it.
- Pointer conversion must not be the place where layout constraints are applied.
- If node world bounds are needed, they belong to layout constraints, not projection conversion.

Expected file direction:

- Keep core force simulation in `packages/graph-engine/src/sim/index.ts`.
- Add a render-side bridge near the renderer, likely `packages/graph-engine/src/render/simulation-bridge.ts`, only if extracting from `static-renderer.ts` materially improves clarity.

## Community Wash Behavior

Community wash represents the visible region of a community. It is not a fence.

Desired behavior:

1. A node can be dragged outside the current wash.
2. The wash responds to the new layout.
3. Normal movements stretch the wash organically.
4. Extreme outliers create a bounded extension instead of unlimited wash growth.
5. Community membership remains data-driven; dragging does not move a page to another community.

Proposed algorithm:

- Compute a core hull/ellipse from the densest majority of the community's nodes.
- Include pinned or dragged outlier nodes as external influence points.
- Apply a capped expansion factor to the core ellipse.
- If an outlier exceeds the cap, represent it through limited directional stretch rather than full bounding-box expansion.
- Keep opacity stable so a stretched wash does not overpower the map.

Practical constraints:

- Minimum wash size remains similar to today so small communities remain visible.
- Maximum wash width/height should be a fraction of the world dimensions.
- Maximum outlier influence should be capped per axis.
- The cap must be testable with deterministic fixtures.

This lets the wash feel alive without letting a single dragged node dominate the full graph.

## Interaction Contracts

### Wheel Zoom

- Works over blank graph.
- Works over nodes.
- Works over community washes.
- Does not trigger over search, toolbar, drawer, legend, minimap controls, or text editing controls.
- Zoom anchor is the pointer location in screen space.

### Blank Canvas Pan

- Pointerdown on blank graph prepares a pan.
- Movement over threshold becomes pan.
- Pointerup without movement is a blank click.
- Blank click closes transient UI first.
- In community focus, blank click can retreat from the focused view after transient UI is handled.

### Node Drag

- Pointerdown on node prepares node drag.
- Movement over threshold becomes drag.
- Node stays under the grabbed pointer point.
- Drag target is computed by screen-to-world projection using the current viewport.
- Drag can move outside the current community wash.
- Drag does not accidentally open the drawer.
- Pointerup ends drag and persists a pin.

### Node Click

- Click opens the reading drawer.
- Shift-click toggles manual selection.
- Click and drag are disambiguated by pointer movement threshold.

### Hover Preview

- Opens after the existing hover delay.
- Uses the current projected node/edge screen position.
- Repositions on viewport commit and motion frame while open.
- Stays inside the graph viewport and avoids drawer overlap through available bounds.
- Does not block node dragging or wheel zoom.

### Community Click

- Clicking community wash enters community focus and opens the community selection state.
- It does not prevent wheel zoom.
- It does not create a drag boundary.

### Minimap

- Minimap is a control surface.
- Main graph gestures do not leak through minimap.
- Minimap viewport rectangle is derived from the same viewport state as the main graph.

## Data Flow

1. Graph data enters `buildRenderableGraph`.
2. Renderable graph exposes world positions for nodes, edges, and communities.
3. Viewport stores the current camera.
4. Geometry projects world positions to layer/screen/minimap positions.
5. Renderer applies DOM styles from projected positions.
6. User input enters Gestures.
7. Gestures use Geometry to interpret pointer locations.
8. Node drag goes through Simulation Bridge.
9. Motion frames update world positions for visible nodes.
10. Overlays recompute hover and wash positions from current world positions and viewport.
11. Drag end persists pins by wiki-relative path.

No component should infer a coordinate space from a raw number. The caller must know whether it is using world, layer, screen, or minimap coordinates.

## Testing Strategy

### Unit Tests

Viewport:

- Zoom around pointer preserves the pointer anchor.
- Pan changes viewport translation without changing scale.
- Fit/center functions preserve intended scale limits.
- Resize keeps selected/focused anchor visually comfortable.

Geometry:

- World to screen and screen to world are inverse operations for common viewport states.
- Projection works under pan and zoom.
- Projection works when viewport host size changes.
- Drag projection can represent pointer positions outside the currently visible world bounds without silent clamping.
- World deltas convert to layer pixels correctly for non-1000px-wide viewports.

Gestures:

- Wheel is allowed over nodes and community washes.
- Wheel is blocked over controls.
- Pointer target classification separates node drag, blank pan, community click, minimap control, and UI controls.
- Click vs drag threshold prevents accidental drawer opens after drag.

Overlays:

- Node hover preview uses projected node screen position.
- Edge hover preview uses projected edge midpoint.
- Hover preview remains inside graph bounds.
- Hover preview repositions after viewport changes.

Community Wash:

- Wash grows for normal node movement.
- Wash has a maximum expansion cap for outliers.
- Dragged outlier does not change community membership.
- Wash remains deterministic for stable fixtures.

Simulation Bridge:

- Drag target is world-space.
- Grab offset is preserved.
- End drag persists the final position.
- Double-click unpins without changing community membership.

### Browser Verification

Run against the workbench at `localhost:5180`:

1. Open the graph view.
2. Enter a community focus view.
3. Wheel over blank graph, node, and community wash.
4. Drag a node within the wash.
5. Drag a node outside the wash.
6. Confirm the node tracks the pointer without jumping.
7. Confirm the wash stretches but does not grow without bound.
8. Hover the dragged node before and after zoom.
9. Open the right drawer and repeat hover and drag.
10. Click node and confirm drawer opens.
11. Click community wash and confirm community selection/focus still works.
12. Pan the blank canvas and confirm minimap updates.
13. Reset view and confirm graph returns to a stable full-graph view.

### Regression Coverage

The final implementation should include tests for the three recent regressions:

- Wheel over community wash.
- Wheel over node.
- Dragged node under zoom follows the pointer.

It should also add tests for the two newly reported regressions:

- Node can be dragged outside the community wash.
- Hover preview follows projected node position under pan/zoom/focus/drawer states.

## Implementation Notes

The implementation should be phased to reduce risk while still being architectural:

1. Introduce Geometry and move projection helpers into it.
2. Update hover preview and edge preview to use Geometry.
3. Update node drag to use unclamped screen-to-world projection plus explicit layout constraints.
4. Extract gesture classification from `static-renderer.ts`.
5. Move community wash computation toward bounded deformation.
6. Add browser verification for the full interaction matrix.

Each phase should have tests before behavior changes where practical. Avoid mixing visual restyling with this refactor.

## Acceptance Criteria

The refactor is complete when:

- There is one documented path for world/screen/minimap coordinate conversion.
- `static-renderer.ts` no longer owns ad hoc coordinate formulas for drag, hover, wheel, and minimap.
- Nodes can be dragged outside community washes.
- Hover previews stay visually attached to nodes after pan, zoom, community focus, drag, and drawer open.
- Wheel zoom works over blank graph, nodes, and community washes.
- Community washes stretch within a bounded rule and do not become hard drag fences.
- Existing node click, community click, Shift selection, blank pan, double-click reset, and unpin behaviors still work.
- Unit tests cover projection, gesture target classification, hover positioning, drag bounds, and bounded wash deformation.
- Browser verification passes on the workbench.

## Risks and Mitigations

Risk: Moving coordinate logic can regress current graph navigation.
Mitigation: Keep viewport unit tests broad and run browser verification before commit.

Risk: Community wash deformation could make the visual design noisy.
Mitigation: Cap expansion and preserve low opacity; test with outlier fixtures.

Risk: `static-renderer.ts` extraction may become a broad refactor.
Mitigation: Extract only position/gesture/overlay responsibilities. Leave rendering markup and CSS in place unless a direct boundary requires movement.

Risk: Workbench and offline HTML diverge.
Mitigation: Keep the behavior in `@llm-wiki/graph-engine` and verify through engine tests. Avoid workbench-only gesture logic.

## Decision

Use the Graph Interaction Geometry approach.

This is intentionally more than a bug patch and less than a renderer rewrite. It fixes the architectural source of the current regression class: position-sensitive graph behavior must not be scattered across unrelated renderer functions.
