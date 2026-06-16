# Graph Interaction Architecture Design

Date: 2026-06-16

## Summary

The graph interaction bugs are not isolated pointer-handling mistakes. They come from an architectural gap: node placement, viewport transforms, pointer gestures, hover previews, community washes, minimap state, and render state currently compute or own positions in different places with different assumptions.

External graph architecture research confirms that the current `@llm-wiki/graph-engine` foundation is directionally strong: it already has a viewport system, live simulation, pin persistence, community tracking, density modes, and diff handling. The issue is not that the renderer technology is wrong. The issue is that the graph front-end lacks clear boundaries between state, layout, camera/geometry, gestures, overlays, and rendering.

This design upgrades the earlier "geometry layer" plan into a standard graph interaction architecture. The goal is to make every position-sensitive behavior use one shared model:

- World position: where nodes, edges, and communities live in the graph model.
- Viewport/camera: how the user is currently looking at that world through pan and zoom.
- Screen position: where the user sees things and where the pointer is.
- Projection: the only allowed way to convert between world, layer, minimap, and screen spaces.
- Interaction rules: drag, wheel, pan, hover, and selection all use the same projection.
- Graph state: one explicit owner for visual, layout, viewport, hover, selection, and gesture state.
- Renderer boundary: drawing code paints a state, but does not interpret user gestures.

The implementation should not be an MVP patch and should not be a full renderer rewrite. It should keep DOM+SVG for now, preserve the public engine API, and carve the graph front-end into explicit, testable modules.

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

External project research adds a second conclusion: geometry centralization is necessary, but not sufficient. Mature graph products and libraries repeatedly separate these concerns:

- Layout computes graph positions and indexes.
- Camera/geometry converts those positions to what the user sees.
- Gestures translate DOM events into graph intentions.
- Renderer draws the current graph state.
- A facade coordinates state changes and host callbacks.

The closest reference is Logseq's graph architecture: data, layout logic, rendering, interaction, and orchestration are separated enough that layout logic can be tested apart from the browser. Its Pixi.js/WebGL renderer is not the right fit for llm-wiki's current scale, but its layering and single gesture pipeline are the right ideas to borrow. Athens contributes the lesson that a clean event model is useful, while full event sourcing, Datascript, CRDT, or graph database infrastructure would be too heavy here. Graphify contributes the community-detection and pipeline lessons, but its static HTML and delegated vis.js interaction model are not enough for llm-wiki's live graph.

## Goals

1. All graph interactions use one coordinate model.
2. Node dragging follows the pointer under pan, zoom, drawer resize, and community focus.
3. Nodes can be dragged outside their community wash.
4. Community wash shapes can respond to dragged nodes, but cannot grow without bounds.
5. Hover previews follow the node's actual rendered position.
6. Wheel zoom behavior is consistent over blank canvas, nodes, and community washes.
7. Pointer panning, node dragging, node click, community click, and minimap interaction do not conflict.
8. Gesture interpretation is centralized instead of spread across renderer callbacks.
9. Graph visual state is centralized instead of hidden across renderer closures and DOM datasets.
10. The renderer becomes a drawing layer instead of the owner of coordinate math or interaction rules.
11. Hit testing has an explicit path that can later use a spatial index.
12. Zoom level and density decisions have one policy instead of scattered thresholds.
13. The same engine behavior remains available to both the workbench graph and Skill/offline graph.

## Non-Goals

- Do not rewrite graph data generation.
- Do not change community membership semantics.
- Do not change relation edge color/typing rules.
- Do not redesign the drawer content model.
- Do not introduce a new rendering technology such as Canvas or WebGL.
- Do not add a new npm dependency.
- Do not implement free-form lasso selection.
- Do not change the knowledge-base pin storage format unless a compatibility shim proves necessary.
- Do not introduce Neo4j, Datascript, CRDT, or full event sourcing for this graph UI refactor.
- Do not migrate DOM+SVG to Canvas 2D until profiling proves the current renderer is the bottleneck.
- Do not add a graph database or LLM-driven graph rebuild step as part of this interaction refactor.

## Design Principle

The graph is a map with a camera.

Every position-aware feature must answer these questions explicitly:

1. Is this value in world space, viewport/layer space, screen space, or minimap space?
2. Which function converts it?
3. Which layer is allowed to clamp or constrain it?
4. Is this a structural fact, a layout choice, or temporary UI state?

If a function cannot answer those questions, it should not own coordinate math.

## Proposed Architecture

Use the standard graph interaction route from the research, adapted to llm-wiki's current strengths:

```
GraphData
  -> GraphLayout
  -> GraphViewport / Geometry
  -> GraphRenderer / Overlays

DOM events
  -> GraphGestures
  -> GraphIntent
  -> GraphFacade
  -> GraphState update
  -> Layout / Viewport / Renderer updates
```

The public API should continue to look like one graph engine. Internally, each module has a narrow job and can be tested without loading the whole renderer.

### 0. Graph State Module

Owns the graph UI state that is currently spread across closures, DOM datasets, and renderer-local variables.

Responsibilities:

- Store current graph data and renderable graph.
- Store layout positions and pin state.
- Store current viewport/camera state.
- Store hover, selected node, selected community, focus, and drawer-related visual state.
- Store gesture state such as active drag session and gesture lock.
- Expose a small subscription mechanism for renderer updates.

Rules:

- State is not business data. The host still owns the current knowledge base, current conversation, and page content.
- State is not a new global store library. Use a small typed object and explicit update functions.
- Renderer code reads state snapshots; it does not create hidden state islands.
- Gestures produce intent; the facade decides how intent mutates state.

Expected file direction:

- New file: `packages/graph-engine/src/render/state.ts` or `packages/graph-engine/src/state/index.ts`.
- Keep it local to graph-engine. Do not introduce Zustand, Redux, or another dependency.

### 1. Viewport / Camera Module

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

### 3. Layout / Spatial Index Module

Owns layout outputs that are not directly about drawing.

Responsibilities:

- Keep the current static and live simulation layout behavior.
- Produce or update node world positions.
- Build a spatial index from current node and edge positions.
- Provide hit-test candidates for nodes, edges, and community washes.
- Provide zoom-level-aware culling or density recommendations when needed.
- Compute drag influence weights if connected nodes should follow the dragged node.

Rules:

- Layout does not know DOM elements.
- Layout does not know hover cards, drawers, or toolbar controls.
- Spatial index stores graph-world positions and sizes, not screen guesses.
- Hit testing can start simple, but it must have one owned path so the renderer does not keep inventing event target rules.

Research references:

- Logseq uses a simple grid spatial index for fast hit testing.
- Graphify's community pipeline shows that deterministic community IDs and remapping matter, but llm-wiki's current Jaccard tracking is already strong and should be preserved.

Expected file direction:

- Keep `packages/graph-engine/src/sim/index.ts` for force simulation for now.
- Add `packages/graph-engine/src/layout/spatial-index.ts` when the gesture extraction needs graph-owned hit testing.
- Do not migrate the whole layout package until the interaction state boundary is stable.

### 4. Gestures Module

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

### 5. Renderer Module

Owns DOM/SVG painting.

Responsibilities:

- Render nodes, edges, community washes, minimap, labels, and density states from graph state.
- Apply viewport transforms from the camera module.
- Update DOM incrementally where needed.
- Delegate hover preview and floating UI placement to the overlays module.

Rules:

- Renderer does not decide whether a pointer event is a drag, click, or pan.
- Renderer does not convert screen coordinates except through Geometry.
- Renderer does not own hidden selection, hover, drag, or focus state.
- Renderer remains DOM+SVG for this refactor.

Expected file direction:

- Keep `packages/graph-engine/src/render/static-renderer.ts` as the shell during migration.
- Extract focused helpers only after state, geometry, and gestures have tests.
- Do not switch to Canvas or WebGL in this phase.

### 6. Overlays Module

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

### 7. Simulation Bridge

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

### 8. Graph Facade

Owns orchestration between host API, graph state, layout, viewport, gestures, renderer, and persistence.

Responsibilities:

- Preserve the current public `createGraphEngine` style API.
- Register gesture intent handlers.
- Decide how graph intents mutate state.
- Call simulation, viewport, renderer, overlay, and host callbacks in the correct order.
- Keep workbench and offline Skill output on the same engine behavior.

Rules:

- Facade is allowed to coordinate modules.
- Other modules should not import across layers just to "reach" behavior.
- Host callbacks receive semantic events such as open page, selection changed, pin persisted, and focus changed.

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
2. GraphState stores the current renderable graph, viewport, selection, hover, focus, pins, and gesture state.
3. Layout and simulation expose world positions for nodes, edges, and communities.
4. Geometry projects world positions to layer/screen/minimap positions.
5. Renderer applies DOM/SVG styles from state and projected positions.
6. User input enters Gestures.
7. Gestures classify the event target and emit an intent such as zoom, pan, drag node, hover node, click node, or click community.
8. GraphFacade handles the intent and mutates GraphState.
9. Node drag goes through Simulation Bridge using world-space targets.
10. Motion frames update world positions for visible nodes and rebuild hit-test data as needed.
11. Overlays recompute hover and wash positions from current world positions and viewport.
12. Drag end persists pins by wiki-relative path.

No component should infer a coordinate space from a raw number. The caller must know whether it is using world, layer, screen, or minimap coordinates.

Renderer code should not directly decide graph intent. Gesture code should not directly mutate DOM. Layout code should not know UI controls. These boundaries are the core regression guard.

## Testing Strategy

### Unit Tests

Graph State:

- State updates are explicit and observable through one subscription path.
- Hover, selection, focus, drag, viewport, and pins do not live in separate hidden stores.
- Renderer receives a state snapshot and does not mutate graph state directly.

Viewport:

- Zoom around pointer preserves the pointer anchor.
- Pan changes viewport translation without changing scale.
- Fit/center functions preserve intended scale limits.
- Resize keeps selected/focused anchor visually comfortable.
- Zoom level transitions are deterministic for the same scale values.

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
- Gesture lock prevents new drag/pan/zoom starts during transitions.
- Gesture handlers emit intents and do not mutate DOM directly.

Spatial Index:

- Hit testing returns the expected node near a point.
- Hit testing respects current world positions after drag.
- Rebuilding the index after simulation movement updates results.
- Large fixture hit testing stays below the chosen time budget.

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

Facade / Integration:

- A wheel DOM event becomes a zoom intent, then a viewport state change, then a renderer update.
- A node pointer sequence below the drag threshold becomes a node click and opens the drawer.
- A node pointer sequence above the drag threshold becomes node drag and does not open the drawer.
- A community click enters community focus without blocking wheel zoom.

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

The implementation should be phased to reduce risk while still being architectural. Do not start by patching the currently visible drag or hover bugs in place.

1. Establish graph state and geometry contracts.
   - Define GraphState shape.
   - Move projection helpers into Geometry.
   - Remove silent coordinate clamping from projection paths.
   - Add tests before changing behavior.

2. Centralize gesture interpretation.
   - Extract wheel, pointer, drag, click, community click, hover, and minimap target classification from `static-renderer.ts`.
   - Make gesture handlers emit intents.
   - Add jsdom tests for intent generation.

3. Route existing behavior through facade/state.
   - Keep public API stable.
   - Preserve node click, drawer open, selection, focus, pin persistence, and reset behavior.
   - Ensure workbench and offline graph use the same engine behavior.

4. Fix overlays and drag through the new path.
   - Hover and edge previews use projected screen positions.
   - Node drag uses unclamped screen-to-world projection plus explicit layout constraints.
   - Grab offset is preserved.

5. Rework community wash as a soft visual region.
   - Nodes can leave the current wash.
   - Wash recomputes from current member positions.
   - Normal movement stretches the wash.
   - Extreme outliers are bounded through capped influence.

6. Add spatial index and zoom-level policy.
   - Add one hit-test path for nodes, edges, and community washes.
   - Add zoom level thresholds for density and label behavior.
   - Keep rendering technology unchanged.

7. Split renderer only after behavior is under tests.
   - Extract node, edge, community, minimap, overlay, and density helpers.
   - Leave styling and markup stable unless the boundary requires movement.

8. Add browser verification for the full interaction matrix.

Each phase should have tests before behavior changes where practical. Avoid mixing visual restyling with this refactor.

## Acceptance Criteria

The refactor is complete when:

- There is one explicit graph state owner for hover, selection, focus, viewport, pins, and drag state.
- There is one documented path for world/screen/minimap coordinate conversion.
- `static-renderer.ts` no longer owns ad hoc coordinate formulas for drag, hover, wheel, minimap, and community wash behavior.
- Renderer code no longer directly interprets graph gestures.
- Gesture code emits graph intents and does not directly mutate DOM.
- Nodes can be dragged outside community washes.
- Hover previews stay visually attached to nodes after pan, zoom, community focus, drag, and drawer open.
- Wheel zoom works over blank graph, nodes, and community washes.
- Community washes stretch within a bounded rule and do not become hard drag fences.
- Hit testing has one graph-owned path, with spatial index support or a tested compatibility implementation.
- Zoom level / density behavior has one policy source.
- Existing node click, community click, Shift selection, blank pan, double-click reset, and unpin behaviors still work.
- Unit tests cover graph state, projection, gesture intent classification, hover positioning, drag bounds, bounded wash deformation, and facade integration.
- Browser verification passes on the workbench.

## Risks and Mitigations

Risk: Moving coordinate logic can regress current graph navigation.
Mitigation: Keep viewport unit tests broad and run browser verification before commit.

Risk: Community wash deformation could make the visual design noisy.
Mitigation: Cap expansion and preserve low opacity; test with outlier fixtures.

Risk: `static-renderer.ts` extraction may become a broad refactor.
Mitigation: Establish GraphState, Geometry, and Gestures first. Split renderer helpers only after behavior is under tests.

Risk: Workbench and offline HTML diverge.
Mitigation: Keep the behavior in `@llm-wiki/graph-engine` and verify through engine tests. Avoid workbench-only gesture logic.

Risk: The refactor becomes a renderer rewrite.
Mitigation: Keep DOM+SVG. Do not adopt Canvas, WebGL, Pixi.js, or a new rendering dependency in this phase.

Risk: The state layer turns into a general app store.
Mitigation: Keep GraphState graph-local. Host business state stays outside graph-engine.

## Decision

Use the standard Graph Interaction Architecture approach:

- Keep the current graph-engine strengths: DOM+SVG rendering, live d3 simulation, pin persistence, density modes, minimap, Jaccard community tracking, and shared workbench/offline behavior.
- Add the missing front-end architecture: GraphState, Geometry, Gestures, Renderer boundaries, Overlays, Layout/SpatialIndex, Simulation Bridge, and GraphFacade.
- Do not choose the conservative patch route; it cannot prevent the next interaction regression.
- Do not choose the aggressive renderer rewrite route; WebGL/Canvas would add risk before the current scale demands it.

This is intentionally more than a bug patch and less than a rendering-technology migration. It fixes the architectural source of the current regression class: position-sensitive graph behavior and graph gesture behavior must not be scattered across unrelated renderer functions.
