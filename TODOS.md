# TODOs

## Phase 2.1: Community Enter Transition

- **What:** Add a lightweight transition from the selected Sigma community region into the DOM community reading view.
- **Why:** Phase 2 intentionally fixes the static close-up first. Once that landing view is stable, a short transition can make the route change feel more continuous.
- **Context:** Do this only after Phase 2 passes browser screenshots and manual QA. The transition must not change final node positions, label rules, edge layers, or source community context state.
- **Depends on:** Phase 2 local-map implementation and visual acceptance.
- **Start with:** Reuse the selected community region bounds from Sigma and the focused DOM community root bounds; animate camera/opacity only if the final static map remains identical before and after the transition.
