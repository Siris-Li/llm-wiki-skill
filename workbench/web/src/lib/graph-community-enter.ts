import type { GraphEngine, Selection } from "@llm-wiki/graph-engine";

/**
 * Entering a community records where the user came from, then changes the graph
 * route to Sigma community reading. Source context is separate from selection:
 * it can restore the global highlight on return without making every node in
 * that community look selected/core inside the reading view.
 */
export function applyCommunityEnter(engine: GraphEngine, communityId: string): Selection | null {
	engine.clearSelection();
	engine.setSourceCommunityContext(communityId);
	engine.focusCommunity(communityId);
	return null;
}
