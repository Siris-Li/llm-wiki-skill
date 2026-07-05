import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { graphCommunitySummaryDrawer, graphNodeSummaryDrawer, graphReaderDrawer, graphSelectionDrawer, wikiDrawer } from "../src/lib/drawer-state";
import { graphCloseCommandForDrawer, shouldCloseDrawerAfterGraphSelectionClear } from "../src/lib/graph-drawer-close";
import type {
	GraphCommunitySummaryPayload,
	GraphNodeSummaryPayload,
	GraphOpenPagePayload,
	Selection,
} from "@llm-wiki/graph-engine";

describe("graph drawer close behavior", () => {
	it("clears graph selection when closing community and selection drawers", () => {
		assert.equal(graphCloseCommandForDrawer(graphCommunitySummaryDrawer(communitySummaryFixture()), "button")?.type, "clear-selection");
		assert.equal(graphCloseCommandForDrawer(graphSelectionDrawer(selectionFixture(), "选区"), "escape")?.type, "clear");
	});

	it("does not clear graph selection when closing a node summary drawer", () => {
		assert.equal(graphCloseCommandForDrawer(graphNodeSummaryDrawer(nodeSummaryFixture()), "button"), null);
	});

	it("keeps node relation focus when closing node content with the close button", () => {
		assert.equal(graphCloseCommandForDrawer(graphReaderDrawer(graphReaderPayloadFixture()), "button"), null);
	});

	it("clears node reading and relation focus when closing node content with Escape", () => {
		assert.equal(graphCloseCommandForDrawer(graphReaderDrawer(graphReaderPayloadFixture()), "escape")?.type, "clear");
	});

	it("closes node reading when the graph reports a blank selection clear", () => {
		assert.equal(shouldCloseDrawerAfterGraphSelectionClear(graphReaderDrawer(graphReaderPayloadFixture())), true);
		assert.equal(shouldCloseDrawerAfterGraphSelectionClear(graphSelectionDrawer(selectionFixture(), "选区")), true);
		assert.equal(shouldCloseDrawerAfterGraphSelectionClear(graphNodeSummaryDrawer(nodeSummaryFixture())), true);
		assert.equal(shouldCloseDrawerAfterGraphSelectionClear(wikiDrawer("wiki/paper.md")), false);
	});
});

function communitySummaryFixture(overrides: Partial<GraphCommunitySummaryPayload> = {}): GraphCommunitySummaryPayload {
	return {
		kind: "community-summary",
		object: { kind: "community", communityId: "build" },
		communityId: "build",
		label: "Knowledge Build",
		nodeCount: 2,
		facts: { pageCount: 2, internalLinkCount: 1, communityCount: 1, isolatedCount: 0 },
		structureState: "clear",
		description: "结构清晰。",
		canEnterCommunity: true,
		coreNodeIds: ["a", "b"],
		coreNodes: [
			{ nodeId: "a", label: "Alpha", type: "topic", role: "核心" },
			{ nodeId: "b", label: "Beta", type: "entity", role: "相关" },
		],
		searchResultIds: [],
		pinHints: [],
		selection: {
			input: { kind: "community", id: "build" },
			selectionId: "community:a,b",
			selectedNodeIds: ["a", "b"],
			selectedCommunityIds: ["build"],
			containsCurrentObject: true,
		},
		strongestRelations: [],
		bridgeRelations: [],
		aggregationMarkers: [],
		commands: [{ kind: "enter-community", communityId: "build", label: "进入社区" }],
		...overrides,
	};
}

function selectionFixture(overrides: Partial<Selection> = {}): Selection {
	return {
		id: "community:a,b",
		nodeIds: ["a", "b"],
		communityIds: ["build"],
		facts: { pageCount: 2, internalLinkCount: 1, communityCount: 1, isolatedCount: 0 },
		input: { kind: "community", id: "build" },
		actions: [],
		...overrides,
	};
}

function nodeSummaryFixture(overrides: Partial<GraphNodeSummaryPayload> = {}): GraphNodeSummaryPayload {
	return {
		kind: "node-summary",
		object: { kind: "node", nodeId: "a" },
		nodeId: "a",
		label: "Alpha",
		type: "topic",
		communityId: "build",
		sourcePath: "wiki/a.md",
		summary: null,
		connectionCount: 1,
		searchHit: false,
		pinHint: { nodeId: "a", wikiPath: "wiki/a.md", pinned: false, position: null },
		selection: {
			input: { kind: "node", id: "a" },
			selectionId: "node:a",
			selectedNodeIds: ["a"],
			selectedCommunityIds: ["build"],
			containsCurrentObject: true,
		},
		strongestRelations: [],
		bridgeRelations: [],
		aggregationMarkers: [],
		commands: [],
		...overrides,
	};
}

function graphReaderPayloadFixture(overrides: Partial<GraphOpenPagePayload> = {}): GraphOpenPagePayload {
	return {
		path: "wiki/a.md",
		node: {
			id: "a",
			title: "Alpha",
			type: "topic",
			communityId: "build",
			sourcePath: "wiki/a.md",
		},
		actions: [],
		...overrides,
	};
}
