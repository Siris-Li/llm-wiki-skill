import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommunityEnter } from "../src/lib/graph-community-enter";
import type { GraphEngine, Selection } from "@llm-wiki/graph-engine";

describe("applyCommunityEnter", () => {
	it("clears the prior selection highlight before focusing the community", () => {
		const calls: string[] = [];
		const selection: Selection = {
			id: "community:alpha",
			nodeIds: ["a1"],
			communityIds: ["alpha"],
			facts: { pageCount: 1, internalLinkCount: 0, communityCount: 1, isolatedCount: 1 },
			input: { kind: "community", id: "alpha" },
			actions: [],
		};
		const engine = {
			clearSelection() {
				calls.push("clear");
			},
			focusCommunity(id: string) {
				calls.push(`focus:${id}`);
				return selection;
			},
		} as unknown as GraphEngine;

		const result = applyCommunityEnter(engine, "alpha");

		assert.deepEqual(calls, ["clear", "focus:alpha"]);
		assert.equal(result, null);
	});
});
