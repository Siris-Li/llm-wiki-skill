import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphData, GraphOpenPagePayload, GraphSummaryObjectRef, GraphVisibilityState } from "@llm-wiki/graph-engine";
import { closedDrawer, graphReaderDrawer } from "../src/lib/drawer-state";
import {
	drawerForGraphNodeVisibility,
	drawerAfterGraphDataRefresh,
	graphReaderStaleAfterRefresh,
	temporaryObjectAfterGraphDataRefresh,
} from "../src/lib/graph-data-refresh";

describe("graph data refresh drawer state", () => {
	it("keeps the current graph reader open when type filters only hide it", () => {
		const current = graphReaderDrawer(openPagePayload("a", "c1"), { content: "# Alpha" });
		const visibility: GraphVisibilityState = {
			searchQuery: "",
			searchResultIds: [],
			typeFilters: { topic: false },
			temporaryObject: null,
			focusCommunityId: "c1",
			hiddenReadingNodeId: "a",
		};

		assert.equal(graphReaderStaleAfterRefresh(current, graphData("c1"), visibility), false);
		const next = drawerAfterGraphDataRefresh(current, graphData("c1"), {
			pins: {},
			visibility,
			temporaryObject: null,
		});

		assert.equal(next.mode, "graph-reader");
		assert.equal(next.mode === "graph-reader" ? next.filteredHidden : null, true);
		assert.equal(next.mode === "graph-reader" ? next.content : null, "# Alpha");
	});

	it("closes the graph reader only when refreshed data loses the node or moves it outside the focused community", () => {
		const current = graphReaderDrawer(openPagePayload("a", "c1"), { content: "# Alpha" });
		const visibility: GraphVisibilityState = {
			searchQuery: "",
			searchResultIds: [],
			typeFilters: {},
			temporaryObject: null,
			focusCommunityId: "c1",
			hiddenReadingNodeId: null,
		};

		assert.equal(graphReaderStaleAfterRefresh(current, graphData("c1"), visibility), false);
		const missingNodeInFocusedCommunity = {
			...graphData("c1"),
			nodes: [
				{
					id: "community-anchor",
					label: "Anchor",
					type: "topic",
					community: "c1",
					source_path: "wiki/community-anchor.md",
				},
			],
		};
		assert.equal(graphReaderStaleAfterRefresh(current, missingNodeInFocusedCommunity, visibility), true);
		const movedOutsideFocusedCommunity = {
			...graphData("c2"),
			nodes: [
				...graphData("c2").nodes,
				{
					id: "community-anchor",
					label: "Anchor",
					type: "topic",
					community: "c1",
					source_path: "wiki/community-anchor.md",
				},
			],
		};
		assert.equal(graphReaderStaleAfterRefresh(current, movedOutsideFocusedCommunity, visibility), true);

		const missing = drawerAfterGraphDataRefresh(current, missingNodeInFocusedCommunity, {
			pins: {},
			visibility,
			temporaryObject: null,
		});
		const moved = drawerAfterGraphDataRefresh(current, movedOutsideFocusedCommunity, {
			pins: {},
			visibility,
			temporaryObject: null,
		});

		assert.deepEqual(missing, { mode: "closed" });
		assert.deepEqual(moved, { mode: "closed" });
	});

	it("shows an unavailable message when the focused community disappears while the drawer is closed", () => {
		const next = drawerAfterGraphDataRefresh(closedDrawer(), graphData("c2"), {
			pins: {},
			visibility: {
				searchQuery: "",
				searchResultIds: [],
				typeFilters: {},
				temporaryObject: null,
				focusCommunityId: "c1",
				hiddenReadingNodeId: null,
			},
			temporaryObject: null,
		});

		assert.equal(next.mode, "graph-unavailable-object");
		assert.equal(next.mode === "graph-unavailable-object" ? next.payload.reason : null, "missing-community");
		assert.deepEqual(next.mode === "graph-unavailable-object" ? next.payload.object : null, {
			kind: "community",
			communityId: "c1",
		});
	});

	it("drops or downgrades temporary display objects when refreshed data no longer contains them", () => {
		const helper: (data: GraphData | null, object: GraphSummaryObjectRef | null) => GraphSummaryObjectRef | null =
			temporaryObjectAfterGraphDataRefresh;

		assert.deepEqual(helper(graphData("c1"), { kind: "node", nodeId: "a" }), { kind: "node", nodeId: "a" });
		assert.equal(helper({ ...graphData("c1"), nodes: [] }, { kind: "node", nodeId: "a" }), null);
		assert.deepEqual(
			helper(graphData("c1"), { kind: "aggregation", aggregationId: "agg", nodeIds: ["a", "missing"], communityId: "c1" }),
			{ kind: "aggregation", aggregationId: "agg", nodeIds: ["a"], communityId: "c1" },
		);
	});

	it("turns a community-scope hidden node into a summary while temporary display is active", () => {
		const data = graphDataWithExternalNode();
		const hiddenVisibility: GraphVisibilityState = {
			searchQuery: "",
			searchResultIds: [],
			typeFilters: {},
			temporaryObject: null,
			focusCommunityId: "c1",
			hiddenReadingNodeId: null,
		};
		const shownVisibility: GraphVisibilityState = {
			...hiddenVisibility,
			temporaryObject: { kind: "node", nodeId: "external" },
		};

		const hidden = drawerForGraphNodeVisibility(data, "external", closedDrawer(), {
			pins: {},
			visibility: hiddenVisibility,
		});
		const shown = drawerForGraphNodeVisibility(data, "external", hidden, {
			pins: {},
			visibility: shownVisibility,
		});
		const cleared = drawerForGraphNodeVisibility(data, "external", shown, {
			pins: {},
			visibility: hiddenVisibility,
		});

		assert.equal(hidden.mode, "graph-excluded-object");
		assert.equal(shown.mode, "graph-node-summary");
		assert.equal(shown.mode === "graph-node-summary" ? shown.payload.nodeId : null, "external");
		assert.equal(cleared.mode, "graph-excluded-object");
	});

	it("turns a stale community drawer into an unavailable message after refresh", () => {
		const current = {
			mode: "graph-community-summary" as const,
			payload: {
				communityId: "c1",
				label: "Community 1",
				nodeCount: 1,
				description: "Old summary",
				facts: { pageCount: 1, internalLinkCount: 0, communityCount: 1, isolatedCount: 1 },
				structureState: "loose" as const,
				canEnterCommunity: true,
				coreNodeIds: ["a"],
				coreNodes: [],
				searchResultIds: [],
				pinHints: [],
				selection: {
					input: { kind: "community" as const, id: "c1" },
					selectionId: "community:c1",
					selectedNodeIds: ["a"],
					selectedCommunityIds: ["c1"],
					containsCurrentObject: true,
				},
				strongestRelations: [],
				bridgeRelations: [],
				aggregationMarkers: [],
				commands: [],
			},
			freeText: "",
		};

		const next = drawerAfterGraphDataRefresh(current, graphData("c2"), {
			pins: {},
			visibility: {
				searchQuery: "",
				searchResultIds: [],
				typeFilters: {},
				temporaryObject: null,
				focusCommunityId: null,
				hiddenReadingNodeId: null,
			},
			temporaryObject: null,
		});

		assert.equal(next.mode, "graph-unavailable-object");
		assert.equal(next.mode === "graph-unavailable-object" ? next.payload.reason : null, "missing-community");
		assert.deepEqual(next.mode === "graph-unavailable-object" ? next.payload.object : null, {
			kind: "community",
			communityId: "c1",
		});
	});
});

function openPagePayload(id: string, community: string): GraphOpenPagePayload {
	return {
		path: `wiki/${id}.md`,
		node: {
			id,
			title: id,
			type: "topic",
			typeLabel: "主题",
			sourcePath: `wiki/${id}.md`,
			community,
			isolated: false,
		},
	};
}

function graphData(community: string): GraphData {
	return {
		meta: {
			build_date: "2026-07-05",
			wiki_title: "Test",
			total_nodes: 1,
			total_edges: 0,
		},
		nodes: [
			{
				id: "a",
				label: "Alpha",
				type: "topic",
				community,
				source_path: "wiki/a.md",
			},
		],
		edges: [],
	};
}

function graphDataWithExternalNode(): GraphData {
	const base = graphData("c1");
	return {
		...base,
		meta: {
			...base.meta,
			total_nodes: 2,
		},
		nodes: [
			...base.nodes,
			{
				id: "external",
				label: "External",
				type: "source",
				community: "c2",
				source_path: "wiki/external.md",
			},
		],
	};
}
