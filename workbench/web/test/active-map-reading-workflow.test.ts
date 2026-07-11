import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphData, GraphExcludedObjectPayload, GraphOpenPagePayload, PinMap, Selection } from "@llm-wiki/graph-engine";

import { planActiveMapReadingWorkflow } from "../src/lib/active-map-reading-workflow";
import {
	artifactDrawer,
	closedDrawer,
	graphCommunitySummaryDrawer,
	graphExcludedObjectDrawer,
	graphNodeSummaryDrawer,
	graphReaderDrawer,
	graphSelectionDrawer,
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

	it("plans community reading entry with the same drawer snapshot for exit", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryPayloadFixture());
		const plan = workflowPlan(
			{ type: "graph-summary-command", command: { kind: "enter-community", communityId: "c1", label: "进入社区" }, reducedMotion: false },
			{ drawer },
		);

		assert.deepEqual(plan.selectionCommand, { id: "c1", type: "enter-community" });
		assert.equal(plan.drawer, drawer);
		assert.equal(plan.drawerExit?.drawer, drawer);
		assert.equal(typeof plan.drawerExit?.durationMs, "number");
	});

	it("skips the staged community exit under reduced motion", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryPayloadFixture());
		const plan = workflowPlan(
			{ type: "graph-summary-command", command: { kind: "enter-community", communityId: "c1", label: "进入社区" }, reducedMotion: true },
			{ drawer },
		);

		assert.deepEqual(plan.selectionCommand, { id: "c1", type: "enter-community" });
		assert.equal(plan.drawer.mode, "closed");
		assert.equal(plan.drawerExit, null);
	});

	it("does not let visibility or graph refresh interrupt a protected community exit", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryPayloadFixture());
		const visibilityPlan = workflowPlan(
			{ type: "graph-visibility-change" },
			{ drawer, drawerExitProtected: true, visibility: { ...emptyVisibility(), focusCommunityId: "c1" } },
		);
		const refreshPlan = workflowPlan(
			{ type: "graph-data-change", temporaryObject: null },
			{ drawer, drawerExitProtected: true },
		);

		assert.equal(visibilityPlan.drawer, drawer);
		assert.equal(refreshPlan.drawer, drawer);
	});

	it("opens node reading from a community summary without desynchronizing graph focus", () => {
		const plan = workflowPlan({
			type: "graph-summary-command",
			command: { kind: "open-detail-read", nodeId: "a", path: "wiki/a.md", label: "打开详情" },
		});

		assert.equal(plan.pageReadRequest?.payload.node.id, "a");
		assert.equal(plan.pageReadRequest?.syncGraphFocus, false);
		assert.deepEqual(plan.selectionCommand, {
			commandId: "open-detail-a-id",
			id: "c1",
			nodeId: "a",
			type: "enter-community-node",
		});
	});

	it("enters a node's community and selects that same node from the node summary", () => {
		const plan = workflowPlan({
			type: "graph-summary-command",
			command: { kind: "enter-node-community", communityId: "c1", nodeId: "a", path: "wiki/a.md", label: "进入所属社区" },
		});

		assert.equal(plan.pageReadRequest?.payload.node.id, "a");
		assert.equal(plan.pageReadRequest?.syncGraphFocus, false);
		assert.deepEqual(plan.selectionCommand, { id: "c1", nodeId: "a", type: "enter-community-node" });
	});

	it("keeps the graph reader related-pages action as a neighbor selection command", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha" });
		const plan = workflowPlan({ type: "graph-reader-action", actionId: "find_related_pages" }, { drawer });

		assert.deepEqual(plan.selectionCommand, { id: "a", type: "neighbors" });
		assert.equal(plan.drawer, drawer);
	});

	it("returns from a node summary to its original community context", () => {
		const drawer = graphNodeSummaryDrawer(nodeSummaryFixture(), { returnCommunityId: "c1" });
		const plan = workflowPlan({ type: "graph-summary-return-community", communityId: "c1" }, { drawer });

		assert.deepEqual(plan.selectionCommand, { id: "c1", type: "select-community-summary" });
		assert.equal(plan.drawer, drawer);
	});

	it("opens a community core node as a node summary without entering full reading", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryPayloadFixture());
		const plan = workflowPlan({ type: "graph-summary-node-select", nodeId: "b" }, { drawer });

		assert.equal(plan.drawer.mode, "graph-node-summary");
		assert.equal(plan.drawer.mode === "graph-node-summary" ? plan.drawer.payload.nodeId : null, "b");
		assert.equal(plan.drawer.mode === "graph-node-summary" ? plan.drawer.returnCommunityId : null, "c1");
		assert.equal(plan.selectionCommand, undefined);
		assert.equal(plan.pageReadRequest, undefined);
	});

	it("keeps node summary related-pages as a neighbor selection command", () => {
		const drawer = graphNodeSummaryDrawer(nodeSummaryFixture());
		const plan = workflowPlan(
			{ type: "graph-summary-command", command: { kind: "select-neighbors", nodeId: "a", label: "找相关页面" } },
			{ drawer },
		);

		assert.deepEqual(plan.selectionCommand, { id: "a", type: "neighbors" });
		assert.equal(plan.drawer, drawer);
	});

	it("turns graph view reset during node reading back into a node summary", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha" });
		const plan = workflowPlan({ type: "graph-view-reset" }, { drawer });

		assert.equal(plan.clearGraphFocusPath, true);
		assert.equal(plan.drawer.mode, "graph-node-summary");
		assert.equal(plan.drawer.mode === "graph-node-summary" ? plan.drawer.payload.nodeId : null, "a");
	});

	it("keeps preview, pin, show-temporary, and clear-temporary commands as graph commands", () => {
		const preview = workflowPlan({ type: "graph-summary-node-preview", nodeId: "a" });
		const pin = workflowPlan({
			type: "graph-summary-command",
			command: { kind: "set-fixed-position", nodeId: "a", mode: "fix", label: "固定位置" },
		});
		const temporary = workflowPlan({
			type: "graph-summary-command",
			command: { kind: "show-this-object", object: { kind: "node", nodeId: "b" }, label: "显示节点" },
		});
		const clearTemporary = workflowPlan(
			{ type: "graph-summary-command", command: { kind: "clear-temporary-object-display", label: "清理临时对象" } },
			{ drawer: graphNodeSummaryDrawer(nodeSummaryFixture()) },
		);

		assert.deepEqual(preview.selectionCommand, { id: "preview-a-id", nodeId: "a", type: "preview-node" });
		assert.deepEqual(pin.selectionCommand, { id: "fix-a-id", nodeId: "a", mode: "fix", type: "set-fixed-position" });
		assert.deepEqual(temporary.temporaryObject, { kind: "node", nodeId: "b" });
		assert.deepEqual(temporary.selectionCommand, {
			id: "show-temporary-object-id",
			object: { kind: "node", nodeId: "b" },
			type: "show-temporary-object",
		});
		assert.equal(temporary.drawer.mode, "graph-node-summary");
		assert.deepEqual(clearTemporary.temporaryObject, null);
		assert.deepEqual(clearTemporary.selectionCommand, {
			id: "clear-temporary-object-display-id",
			type: "clear-temporary-object-display",
		});
	});

	it("keeps temporary hidden-object display coherent through workflow visibility events", () => {
		const temporaryObject = { kind: "node" as const, nodeId: "external" };
		const data = graphDataWithExternalNode();
		const visibility = communityFocusedVisibility();
		const hidden = graphExcludedObjectDrawer(excludedExternalNodeFixture());
		const shown = workflowPlan(
			{ type: "graph-summary-command", command: { kind: "show-this-object", object: temporaryObject, label: "显示这个对象" } },
			{ data, drawer: hidden, visibility },
		);

		assert.equal(shown.drawer.mode, "graph-node-summary");
		assert.deepEqual(shown.temporaryObject, temporaryObject);
		assert.deepEqual(shown.selectionCommand, {
			id: "show-temporary-object-id",
			object: temporaryObject,
			type: "show-temporary-object",
		});

		const visible = workflowPlan(
			{ type: "graph-visibility-change" },
			{ data, drawer: shown.drawer, visibility: { ...visibility, temporaryObject } },
		);
		assert.equal(visible.drawer, shown.drawer);
		assert.deepEqual(visible.temporaryObject, temporaryObject);

		const cleared = workflowPlan(
			{ type: "graph-summary-command", command: { kind: "clear-temporary-object-display", label: "清理临时对象" } },
			{ data, drawer: shown.drawer, visibility: { ...visibility, temporaryObject } },
		);
		assert.equal(cleared.drawer.mode, "graph-excluded-object");
		assert.deepEqual(
			cleared.drawer.mode === "graph-excluded-object" ? cleared.drawer.payload.object : null,
			temporaryObject,
		);
		assert.equal(cleared.temporaryObject, null);
		assert.deepEqual(cleared.selectionCommand, {
			id: "clear-temporary-object-display-id",
			type: "clear-temporary-object-display",
		});
	});

	it("preserves the close button and Escape differences for graph drawers", () => {
		const reader = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha" });
		const readerButton = workflowPlan({ type: "graph-drawer-close", reason: "button" }, { drawer: reader });
		const readerEscape = workflowPlan({ type: "graph-drawer-close", reason: "escape" }, { drawer: reader });
		const returnableNode = graphNodeSummaryDrawer(nodeSummaryFixture(), { returnCommunityId: "c1" });
		const nodeEscape = workflowPlan({ type: "graph-drawer-close", reason: "escape" }, { drawer: returnableNode });

		assert.equal(readerButton.drawer.mode, "closed");
		assert.equal(readerButton.selectionCommand, undefined);
		assert.equal(readerButton.clearGraphFocusPath, undefined);
		assert.equal(readerEscape.drawer.mode, "closed");
		assert.equal(readerEscape.selectionCommand?.type, "clear");
		assert.equal(readerEscape.clearGraphFocusPath, true);
		assert.equal(nodeEscape.drawer, returnableNode);
		assert.deepEqual(nodeEscape.selectionCommand, { id: "c1", type: "select-community-summary" });
	});

	it("hands selection questions to the conversation entry and clears the graph interaction", () => {
		const drawer = graphSelectionDrawer(manualMultiSelection(), "Alpha/Beta", "只看这两页的差异");
		const plan = workflowPlan(
			{ type: "graph-selection-ask", actionId: null, newConversation: false },
			{ drawer },
		);

		assert.equal(plan.drawer.mode, "closed");
		assert.deepEqual(plan.selectionCommand, { id: "clear-graph-selection-after-ask-id", type: "clear" });
		assert.equal(plan.conversationHandoff?.newConversation, false);
		assert.match(plan.conversationHandoff?.message ?? "", /补充要求：只看这两页的差异/);
		assert.match(plan.conversationHandoff?.displayText ?? "", /只看这两页的差异/);
	});

	it("hands community questions to a new conversation using the existing recommended action rule", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryPayloadFixture(), "");
		const plan = workflowPlan(
			{ type: "graph-community-ask", actionId: null, newConversation: true },
			{ drawer },
		);

		assert.equal(plan.drawer.mode, "closed");
		assert.deepEqual(plan.selectionCommand, { id: "clear-graph-community-after-ask-id", type: "clear" });
		assert.equal(plan.conversationHandoff?.newConversation, true);
		assert.match(plan.conversationHandoff?.displayText ?? "", /总结这一簇/);
		assert.match(plan.conversationHandoff?.message ?? "", /动作：总结这一簇/);
	});

	it("hands node reader questions back to the conversation without changing send rules", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha body" });
		const plan = workflowPlan({ type: "graph-reader-action", actionId: "quote_page" }, { drawer });

		assert.equal(plan.drawer.mode, "closed");
		assert.deepEqual(plan.selectionCommand, { id: "clear-graph-reader-after-ask-id", type: "clear" });
		assert.equal(plan.conversationHandoff?.newConversation, false);
		assert.match(plan.conversationHandoff?.displayText ?? "", /在对话中引用/);
		assert.match(plan.conversationHandoff?.message ?? "", /\[\[wiki\/a\.md\]\]/);
	});

	it("keeps node reading after refresh when the current node still exists", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha body" });
		const plan = workflowPlan(
			{ type: "graph-data-change" },
			{ drawer, visibility: { ...emptyVisibility(), focusCommunityId: "c1" } },
		);

		assert.equal(plan.drawer.mode, "graph-reader");
		assert.equal(plan.drawer.mode === "graph-reader" ? plan.drawer.content : null, "Alpha body");
		assert.equal(plan.clearGraphFocusPath, undefined);
		assert.equal(plan.selectionCommand, undefined);
	});

	it("refreshes the current node summary payload when graph data changes", () => {
		const drawer = graphNodeSummaryDrawer(nodeSummaryFixture());
		const plan = workflowPlan(
			{ type: "graph-data-change" },
			{ drawer, data: graphDataWithUpdatedNodeALabel() },
		);

		assert.equal(plan.drawer.mode, "graph-node-summary");
		assert.notEqual(plan.drawer, drawer);
		assert.equal(plan.drawer.mode === "graph-node-summary" ? plan.drawer.payload.label : null, "Alpha updated");
	});

	it("safely closes node reading after refresh when the node disappears", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha body" });
		const plan = workflowPlan(
			{ type: "graph-data-change" },
			{
				data: graphDataWithoutNodeA(),
				drawer,
				visibility: { ...emptyVisibility(), focusCommunityId: "c1" },
			},
		);

		assert.equal(plan.drawer.mode, "closed");
		assert.equal(plan.clearGraphFocusPath, true);
		assert.equal(plan.selectionCommand?.type, "clear-selection");
	});

	it("clears graph focus after refresh when the reading node leaves the focused community", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha body" });
		const plan = workflowPlan(
			{ type: "graph-data-change" },
			{
				data: graphDataWithNodeAOutsideFocusedCommunity(),
				drawer,
				visibility: { ...emptyVisibility(), focusCommunityId: "c1" },
			},
		);

		assert.equal(plan.drawer.mode, "closed");
		assert.equal(plan.clearGraphFocusPath, true);
		assert.equal(plan.selectionCommand?.type, "clear-selection");
	});

	it("keeps the existing hidden reader hint when filters or search hide the reading node", () => {
		const drawer = graphReaderDrawer(graphReaderPayloadFixture(), { content: "Alpha body" });
		const plan = workflowPlan(
			{ type: "graph-visibility-change" },
			{ drawer, visibility: { ...emptyVisibility(), hiddenReadingNodeId: "a" } },
		);

		assert.equal(plan.drawer.mode, "graph-reader");
		assert.equal(plan.drawer.mode === "graph-reader" ? plan.drawer.filteredHidden : null, true);
	});

	it("keeps, downgrades, or clears temporary display objects after graph refresh", () => {
		const kept = workflowPlan(
			{ type: "graph-data-change" },
			{ temporaryObject: { kind: "node", nodeId: "a" } },
		);
		const downgraded = workflowPlan(
			{ type: "graph-data-change" },
			{ temporaryObject: { kind: "aggregation", aggregationId: "agg", nodeIds: ["a", "missing"], communityId: "c1" } },
		);
		const cleared = workflowPlan(
			{ type: "graph-data-change" },
			{ data: graphDataWithoutNodeA(), temporaryObject: { kind: "node", nodeId: "a" } },
		);

		assert.deepEqual(kept.temporaryObject, { kind: "node", nodeId: "a" });
		assert.deepEqual(downgraded.temporaryObject, { kind: "aggregation", aggregationId: "agg", nodeIds: ["a"], communityId: "c1" });
		assert.equal(cleared.temporaryObject, null);
	});
});

const emptyPins: PinMap = {};

function workflowPlan(
	event: Parameters<typeof planActiveMapReadingWorkflow>[0]["event"],
	overrides: Partial<Parameters<typeof planActiveMapReadingWorkflow>[0]> = {},
) {
	return planActiveMapReadingWorkflow({
		event,
		data: graphFixture(),
		drawer: closedDrawer(),
		pins: emptyPins,
		visibility: null,
		drawerExitProtected: false,
		createCommandId: (prefix) => `${prefix}-id`,
		...overrides,
	});
}

function emptyVisibility() {
	return {
		searchQuery: "",
		searchResultIds: [],
		typeFilters: {},
		temporaryObject: null,
		focusCommunityId: null,
		hiddenReadingNodeId: null,
	};
}

function communityFocusedVisibility() {
	return { ...emptyVisibility(), focusCommunityId: "c1" };
}

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

function graphDataWithoutNodeA(): GraphData {
	const data = graphFixture();
	return {
		...data,
		nodes: data.nodes.filter((node) => node.id !== "a"),
	};
}

function graphDataWithUpdatedNodeALabel(): GraphData {
	const data = graphFixture();
	return {
		...data,
		nodes: data.nodes.map((node) => (
			node.id === "a" ? { ...node, label: "Alpha updated" } : node
		)),
	};
}

function graphDataWithExternalNode(): GraphData {
	const data = graphFixture();
	return {
		...data,
		nodes: [
			...data.nodes,
			{ id: "external", label: "External", type: "entity", community: "c2", source_path: "wiki/external.md" },
		],
		learning: {
			...data.learning,
			communities: [
				...(data.learning?.communities ?? []),
				{ id: "c2", label: "External community", node_count: 1, color_index: 1, members: ["external"] },
			],
		},
	};
}

function graphDataWithNodeAOutsideFocusedCommunity(): GraphData {
	const data = graphFixture();
	return {
		...data,
		nodes: data.nodes.map((node) => (
			node.id === "a" ? { ...node, community: "c2" } : node
		)),
		learning: {
			...data.learning,
			communities: [
				...(data.learning?.communities ?? []),
				{ id: "c2", label: "Other", node_count: 1, color_index: 1, members: ["a"] },
			],
		},
	};
}

function excludedExternalNodeFixture(): GraphExcludedObjectPayload {
	return {
		kind: "excluded-object",
		object: { kind: "node", nodeId: "external" },
		reason: "community-scope",
		selection: {
			input: { kind: "node", id: "external" },
			selectionId: "node:external",
			selectedNodeIds: ["external"],
			selectedCommunityIds: ["c2"],
			containsCurrentObject: true,
		},
		searchResultIds: [],
		pinHints: [],
		aggregationMarkers: [],
		commands: [
			{ kind: "show-this-object", object: { kind: "node", nodeId: "external" }, label: "显示这个对象" },
			{ kind: "clear-temporary-object-display", label: "清除临时显示" },
		],
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
