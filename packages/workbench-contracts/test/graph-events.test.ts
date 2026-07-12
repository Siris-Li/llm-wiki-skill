import assert from "node:assert/strict";
import test from "node:test";

import {
	GRAPH_SSE_EVENT_TYPES,
	GRAPH_SSE_EVENT_NAME,
	GRAPH_SSE_SCHEMA_VERSION,
	GraphSseEventSchema,
} from "../src/index.js";

const identity = {
	schemaVersion: 1,
	streamId: "graph-stream-1",
} as const;

test("graph SSE schema validates ready, update, and recoverable graph error events", () => {
	const events = [
		{
			...identity,
			seq: 1,
			type: "graph_stream_ready",
			connectedAt: "2026-07-11T12:00:00.000Z",
		},
		{
			...identity,
			seq: 2,
			type: "graph_updated",
			kbPath: "/fake/kb",
			diff: {
				addedNodes: ["new-node"],
				removedNodes: [],
				recoloredNodes: [{ id: "node-1", from: "old", to: "new" }],
				addedEdges: ["edge-1"],
				removedEdges: [],
				newCommunities: ["new"],
				stats: { nodeCount: 2, edgeCount: 1, communityCount: 2 },
			},
			rebuiltAt: "2026-07-11T12:01:00.000Z",
			stats: { nodeCount: 2, edgeCount: 1 },
		},
		{
			...identity,
			seq: 3,
			type: "graph_error",
			kbPath: "/fake/kb",
			message: "图谱重建失败",
			rebuiltAt: "2026-07-11T12:02:00.000Z",
		},
	] as const;

	assert.equal(GRAPH_SSE_SCHEMA_VERSION, 1);
	assert.equal(GRAPH_SSE_EVENT_NAME, "message");
	assert.equal(events.length, GRAPH_SSE_EVENT_TYPES.length);
	for (const event of events) assert.deepEqual(GraphSseEventSchema.parse(event), event);
});

test("graph SSE schema rejects drift in version, stream identity, sequence, and type", () => {
	const valid = {
		...identity,
		seq: 1,
		type: "graph_stream_ready",
		connectedAt: "2026-07-11T12:00:00.000Z",
	} as const;
	for (const invalid of [
		{ ...valid, schemaVersion: 2 },
		{ ...valid, streamId: "" },
		{ ...valid, seq: undefined },
		{ ...valid, type: "unknown_event" },
		{ ...valid, extra: true },
	]) {
		assert.equal(GraphSseEventSchema.safeParse(invalid).success, false);
	}
});
