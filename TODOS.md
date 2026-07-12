# TODOs

## Workbench Test Infrastructure

### Make the Paper visual regression portable

**What:** Remove the machine-specific prototype path from the existing Paper screenshot runner and give it a portable reference or baseline strategy.

**Why:** The current runner is useful for local visual checks, but another machine or GitHub cannot reproduce its default reference without extra private files.

**Context:** This is separate from #190. The #158 closeout will add a new functional Playwright suite that uses a real frontend, real HTTP, and real backend handling; the current `visual:paper` runner continues to serve visual regression only because it mocks all `/api/**` traffic. Start by deciding whether reference images belong in the repository or the runner should require an explicit reference URL, then remove the local default path and verify the documented workflow on a clean machine.

**Effort:** M
**Priority:** P3
**Depends on:** A decision on committed visual baselines versus an explicitly supplied reference URL.

## Live Map Reading Workflow: User-Facing Improvements

- **What:** After the internal active-map reading workflow consolidation lands, improve the visible reading experience for node selection, community entry, right-drawer behavior, and sending a map selection back into the conversation.
- **Why:** The first pass intentionally keeps the UI behavior stable so the structure can be made safer. The second pass should use that cleaner foundation to make the map feel smoother and easier to read.
- **Context:** This belongs after the internal "active-map reading workflow" refactor and before starting the Prompt Run refactor. Keep it focused on user-facing reading flow polish, not graph data generation or knowledge inventory rules.
- **Depends on:** The internal active-map reading workflow consolidation passing regression checks for global graph, community reading, right drawer, and selection-to-conversation behavior.
- **Start with:** Pick one visible pain point from the consolidated workflow, then verify it through the full user path: open map → select/read → use drawer → ask from selection.

## Graph Spatial Continuity: Sigma Community Enter Transition

- **What:** Implement the Sigma spatial transition from a highlighted global community into Sigma community reading; see GitHub #117 and #120.
- **Why:** The user should feel they are moving deeper into the same knowledge map, not switching from one unrelated view to another.
- **Context:** This now belongs to the Sigma-first graph route. The transition should coordinate drawer exit, canvas expansion, camera movement, and community-reading appearance without changing final graph semantics.
- **Depends on:** #118 shared Sigma view-transition basis and the current Sigma community reading route.
- **Start with:** Reuse the selected global community bounds, the Sigma community-reading target camera, and the shared transition/cancellation contract from #118.
