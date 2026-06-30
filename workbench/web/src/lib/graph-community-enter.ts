import type { GraphEngine, Selection } from "@llm-wiki/graph-engine";

/**
 * Entering a community from the community drawer must clear the prior global
 * selection highlight (set when the drawer opened) before focusing the target
 * community. `selectionCommand` is a singular value, so the clear and the
 * focus happen together in this one helper that the graph component calls from
 * its `enter-community` branch.
 */
export function applyCommunityEnter(engine: GraphEngine, communityId: string): Selection | null {
	engine.clearSelection();
	engine.focusCommunity(communityId);
	return null;
}
