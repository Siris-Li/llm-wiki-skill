import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphData, GraphOpenPagePayload, PinMap, Selection } from "@llm-wiki/graph-engine";

import { planActiveMapReadingWorkflow } from "../src/lib/active-map-reading-workflow";
import {
	artifactDrawer,
	closedDrawer,
	graphCommunitySummaryDrawer,
	graphNodeSummaryDrawer,
	graphReaderDrawer,
	wikiDrawer,
} from "../src/lib/drawer-state";
import type { ArtifactManifest } from "../src/lib/api";

describe("active map reading workflow", () => {
	it("opens the same node summary when the graph reports a single node click", () => {
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: nodeSelection() },
			data: graphFixture(),
			drawer: closedDrawer(),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(plan.drawer.mode, "graph-node-summary");
		assert.equal(plan.drawer.mode === "graph-node-summary" ? plan.drawer.payload.nodeId : null, "a");
		assert.deepEqual(
			plan.drawer.mode === "graph-node-summary" ? plan.drawer.payload.commands.map((command) => command.kind) : [],
			["open-detail-read", "select-neighbors", "set-fixed-position", "enter-node-community"],
		);
	});

	it("opens the same community summary when the graph reports a single community click", () => {
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: communitySelection() },
			data: graphFixture(),
			drawer: closedDrawer(),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(plan.drawer.mode, "graph-community-summary");
		assert.equal(plan.drawer.mode === "graph-community-summary" ? plan.drawer.payload.communityId : null, "c1");
		assert.deepEqual(
			plan.drawer.mode === "graph-community-summary" ? plan.drawer.payload.commands.map((command) => command.kind) : [],
			["enter-community"],
		);
	});

	it("keeps manual multi-select as a selection drawer", () => {
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: manualMultiSelection() },
			data: graphFixture(),
			drawer: closedDrawer(),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(plan.drawer.mode, "graph-selection");
		assert.deepEqual(plan.drawer.mode === "graph-selection" ? plan.drawer.selection.nodeIds : [], ["a", "b"]);
		assert.equal(plan.drawer.mode === "graph-selection" ? plan.drawer.title : null, "选中 2 个节点");
	});

	it("keeps manual single-select as selection semantics instead of node reading", () => {
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: manualSingleSelection() },
			data: graphFixture(),
			drawer: closedDrawer(),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(plan.drawer.mode, "graph-selection");
		assert.deepEqual(plan.drawer.mode === "graph-selection" ? plan.drawer.selection.nodeIds : [], ["a"]);
		assert.equal(plan.drawer.mode === "graph-selection" ? plan.drawer.title : null, "Alpha");
	});

	it("closes only graph drawers when the graph reports a cleared selection", () => {
		const graphPlan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: null },
			data: graphFixture(),
			drawer: graphNodeSummaryDrawer(nodeSummaryFixture()),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});
		const wikiPlan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: null },
			data: graphFixture(),
			drawer: wikiDrawer("wiki/a.md", { content: "Alpha" }),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});
		const artifactPlan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: null },
			data: graphFixture(),
			drawer: artifactDrawer([artifactFixture()], "artifact-a"),
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(graphPlan.drawer.mode, "closed");
		assert.equal(wikiPlan.drawer.mode, "wiki");
		assert.equal(artifactPlan.drawer.mode, "artifacts");
	});

	it("does not let graph selection clears interrupt a protected drawer exit", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryPayloadFixture());
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: null },
			data: graphFixture(),
			drawer,
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: true,
		});

		assert.equal(plan.drawer, drawer);
	});

	it("keeps graph reader open when Sigma echoes the currently read node selection", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha" });
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: nodeSelection() },
			data: graphFixture(),
			drawer,
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(plan.drawer, drawer);
	});

	it("keeps the current summary object when the selected graph target is unchanged", () => {
		const drawer = graphNodeSummaryDrawer(nodeSummaryFixture({
			commands: [
				{ kind: "open-detail-read", nodeId: "a", path: "wiki/a.md", label: "打开详情" },
				{ kind: "select-neighbors", nodeId: "a", label: "找相关页面" },
				{ kind: "set-fixed-position", nodeId: "a", mode: "fix", label: "固定位置" },
				{ kind: "enter-node-community", communityId: "c1", nodeId: "a", path: "wiki/a.md", label: "进入所属社区" },
			],
		}));
		const plan = planActiveMapReadingWorkflow({
			event: { type: "graph-selection-change", selection: nodeSelection() },
			data: graphFixture(),
			drawer,
			pins: emptyPins,
			visibility: null,
			drawerExitProtected: false,
		});

		assert.equal(plan.drawer, drawer);
	});
});

const emptyPins: PinMap = {};

function nodeSelection(nodeId = "a"): Selection {
	return {
		id: `node:${nodeId}`,
		nodeIds: [nodeId],
		communityIds: ["c1"],
		facts: { pageCount: 1, internalLinkCount: 0, communityCount: 1, isolatedCount: 0 },
		input: { kind: "node", id: nodeId },
		actions: [],
	};
}

function communitySelection(): Selection {
	return {
		id: "community:a,b",
		nodeIds: ["a", "b"],
		communityIds: ["c1"],
		facts: { pageCount: 2, internalLinkCount: 1, communityCount: 1, isolatedCount: 0 },
		input: { kind: "community", id: "c1" },
		actions: [],
	};
}

function manualMultiSelection(): Selection {
	return {
		...communitySelection(),
		id: "nodes:a,b",
		input: { kind: "nodes", ids: ["a", "b"] },
	};
}

function manualSingleSelection(): Selection {
	return {
		id: "nodes:a",
		nodeIds: ["a"],
		communityIds: ["c1"],
		facts: { pageCount: 1, internalLinkCount: 0, communityCount: 1, isolatedCount: 0 },
		input: { kind: "nodes", ids: ["a"] },
		actions: [],
	};
}

function graphFixture(): GraphData {
	return {
		meta: {
			build_date: "2026-06-18T00:00:00.000Z",
			wiki_title: "Active map workflow test",
			total_nodes: 2,
			total_edges: 1,
		},
		nodes: [
			{ id: "a", label: "Alpha", type: "topic", community: "c1", source_path: "wiki/a.md" },
			{ id: "b", label: "Beta", type: "entity", community: "c1", source_path: "wiki/b.md" },
		],
		edges: [{ id: "a-b", from: "a", to: "b", type: "EXTRACTED", relation_type: "实现", weight: 1 }],
		learning: {
			version: 1,
			entry: { recommended_start_node_id: "a", recommended_start_reason: "hub", default_mode: "global" },
			views: {
				path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
				community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
				global: { enabled: true, node_ids: ["a", "b"], degraded: false },
			},
			communities: [{ id: "c1", label: "Community", node_count: 2, color_index: 0, members: ["a", "b"] }],
		},
	};
}

function nodeSummaryFixture(overrides: Partial<ReturnType<typeof nodeSummaryFixtureBase>> = {}) {
	return {
		...nodeSummaryFixtureBase(),
		...overrides,
	};
}

function nodeSummaryFixtureBase() {
	return {
		kind: "node-summary" as const,
		object: { kind: "node" as const, nodeId: "a" },
		nodeId: "a",
		label: "Alpha",
		type: "topic" as const,
		communityId: "c1",
		sourcePath: "wiki/a.md",
		summary: null,
		connectionCount: 1,
		searchHit: false,
		pinHint: { nodeId: "a", wikiPath: "wiki/a.md", pinned: false, position: null },
		selection: {
			input: { kind: "node" as const, id: "a" },
			selectionId: "node:a",
			selectedNodeIds: ["a"],
			selectedCommunityIds: ["c1"],
			containsCurrentObject: true,
		},
		strongestRelations: [],
		bridgeRelations: [],
		aggregationMarkers: [],
		commands: [],
	};
}

function communitySummaryPayloadFixture() {
	return {
		kind: "community-summary" as const,
		object: { kind: "community" as const, communityId: "c1" },
		communityId: "c1",
		label: "Community",
		nodeCount: 2,
		facts: { pageCount: 2, internalLinkCount: 1, communityCount: 1, isolatedCount: 0 },
		structureState: "clear" as const,
		description: "结构清晰。",
		canEnterCommunity: true,
		coreNodeIds: ["a", "b"],
		coreNodes: [
			{ nodeId: "a", label: "Alpha", type: "topic" as const, role: "核心" },
			{ nodeId: "b", label: "Beta", type: "entity" as const, role: "相关" },
		],
		searchResultIds: [],
		pinHints: [],
		selection: {
			input: { kind: "community" as const, id: "c1" },
			selectionId: "community:a,b",
			selectedNodeIds: ["a", "b"],
			selectedCommunityIds: ["c1"],
			containsCurrentObject: true,
		},
		strongestRelations: [],
		bridgeRelations: [],
		aggregationMarkers: [],
		commands: [{ kind: "enter-community" as const, communityId: "c1", label: "进入社区" }],
	};
}

function graphReaderPayloadFixture(overrides: Partial<GraphOpenPagePayload> = {}): GraphOpenPagePayload {
	return {
		path: "wiki/a.md",
		node: {
			id: "a",
			title: "Alpha",
			type: "topic",
			typeLabel: "主题",
			sourcePath: "wiki/a.md",
			community: "c1",
			date: null,
			source: null,
			isolated: false,
		},
		...overrides,
	};
}

function artifactFixture(): ArtifactManifest {
	return {
		id: "artifact-a",
		kind: "html",
		renderer: "iframe",
		metadata: {
			title: "Artifact",
			createdAt: "2026-07-09T00:00:00.000Z",
			sourceConversationId: "conv-a",
			sourceKbPath: "/tmp/kb",
			sourceSkill: "test",
			sizeBytes: 42,
		},
		files: [{ name: "index.html", sizeBytes: 42, mimeType: "text/html" }],
		primaryFile: "index.html",
	};
}
