import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCommunityEnter } from "../src/lib/graph-community-enter";
import type { GraphEngine } from "@llm-wiki/graph-engine";

describe("applyCommunityEnter", () => {
	it("records source community context separately before entering Sigma community reading", () => {
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

		assert.deepEqual(calls, ["source:alpha", "focus:alpha"]);
		assert.equal(result, null);
	});
});
