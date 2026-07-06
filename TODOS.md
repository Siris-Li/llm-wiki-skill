# TODOs

## Graph Spatial Continuity: Sigma Community Enter Transition

- **What:** Implement the Sigma spatial transition from a highlighted global community into Sigma community reading; see GitHub #117 and #120.
- **Why:** The user should feel they are moving deeper into the same knowledge map, not switching from one unrelated view to another.
- **Context:** This now belongs to the Sigma-first graph route. The transition should coordinate drawer exit, canvas expansion, camera movement, and community-reading appearance without changing final graph semantics.
- **Depends on:** #118 shared Sigma view-transition basis and the current Sigma community reading route.
- **Start with:** Reuse the selected global community bounds, the Sigma community-reading target camera, and the shared transition/cancellation contract from #118.
