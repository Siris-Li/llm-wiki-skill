import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	applyCommunityEnter,
	COMMUNITY_ENTER_EXIT_DURATION_MS,
	planCommunityEnterExit,
} from "../src/lib/graph-community-enter";
import { closedDrawer, graphCommunitySummaryDrawer, type DrawerState } from "../src/lib/drawer-state";
import type {
	GraphCommunitySummaryPayload,
	GraphEngine,
} from "@llm-wiki/graph-engine";

describe("applyCommunityEnter", () => {
	it("clears the old selection and records source community context before entering Sigma community reading", () => {
		const calls: string[] = [];
		const engine = {
			clearSelection() {
				calls.push("clear");
			},
			setSourceCommunityContext(id: string | null) {
				calls.push(`source:${id ?? "none"}`);
			},
			focusCommunity(id: string) {
				calls.push(`focus:${id}`);
			},
		} as unknown as GraphEngine;

		const result = applyCommunityEnter(engine, "alpha");

		assert.deepEqual(calls, ["clear", "source:alpha", "focus:alpha"]);
		assert.equal(result, null);
	});
});

describe("planCommunityEnterExit", () => {
	it("plans a drawer exit transition that keeps the summary mounted while the camera advances", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryFixture(), "看一下缺口");

		const plan = planCommunityEnterExit({
			communityId: "build",
			drawer,
			reducedMotion: false,
		});

		assert.deepEqual(plan.selectionCommand, { id: "build", type: "enter-community" });
		assert.equal(plan.exit != null, true, "non-reduced-motion enter should stage an exit");
		assert.equal(plan.exit?.drawer, drawer, "exit keeps a snapshot of the drawer being left");
		assert.equal(plan.exit?.durationMs, COMMUNITY_ENTER_EXIT_DURATION_MS);
		// 设计文档 §动效节奏：布局/抽屉/镜头过渡落在 250–450ms。
		assert.ok(
			plan.exit != null && plan.exit.durationMs >= 250 && plan.exit.durationMs <= 450,
			`exit duration ${plan.exit?.durationMs} should stay in the 250–450ms layout band`,
		);
	});

	it("skips the exit transition under reduced motion so the drawer just closes", () => {
		const drawer = graphCommunitySummaryDrawer(communitySummaryFixture());

		const plan = planCommunityEnterExit({
			communityId: "build",
			drawer,
			reducedMotion: true,
		});

		assert.deepEqual(plan.selectionCommand, { id: "build", type: "enter-community" });
		assert.equal(plan.exit, null, "reduced motion must skip the staged drawer exit");
	});

	it("does not stage an exit when the drawer is already closed", () => {
		const drawer: DrawerState = closedDrawer();

		const plan = planCommunityEnterExit({
			communityId: "build",
			drawer,
			reducedMotion: false,
		});

		assert.deepEqual(plan.selectionCommand, { id: "build", type: "enter-community" });
		assert.equal(plan.exit, null);
	});

	it("never reopens the community summary: the exit only carries the snapshot away from closed", () => {
		// 进入社区后摘要抽屉应退场、不重开。exit 快照是用户正在离开的那个抽屉，
		// 退场结束才落回 closedDrawer()；plan 本身不发出任何重开指令。
		const drawer = graphCommunitySummaryDrawer(communitySummaryFixture());

		const plan = planCommunityEnterExit({
			communityId: "build",
			drawer,
			reducedMotion: false,
		});

		assert.equal(plan.exit?.drawer.mode, "graph-community-summary");
		assert.equal("reopen" in plan || "nextDrawer" in plan, false, "plan must not describe a follow-up drawer");
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
