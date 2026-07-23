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

const warningSummary = {
	build_id: "b".repeat(64),
	total_groups: 0,
	total_occurrences: 0,
	error_occurrences: 0,
	warning_occurrences: 0,
	by_code: {},
	details_ref: "wiki/graph-warnings.json",
	details_sha256: "d".repeat(64),
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
			diff: {
				addedNodes: ["new-node"],
				removedNodes: [],
				recoloredNodes: [{ id: "node-1", from: "old", to: "new" }],
				addedEdges: ["edge-1"],
				removedEdges: [],
				newCommunities: ["new"],
				migrationWarnings: [
					{
						code: "identity_alignment_ambiguous",
						source_path: "notes/ambiguous.md",
					},
					{
						code: "legacy_semantic_edge_duplicate",
					},
				],
				stats: { nodeCount: 2, edgeCount: 1, communityCount: 2 },
			},
			rebuiltAt: "2026-07-11T12:01:00.000Z",
			stats: { nodeCount: 2, edgeCount: 1 },
			warning_summary: warningSummary,
			warning_details_status: "available",
		},
		{
			...identity,
			seq: 3,
			type: "graph_error",
			message: "图谱重建失败",
			rebuiltAt: "2026-07-11T12:02:00.000Z",
		},
	] as const;

	assert.equal(GRAPH_SSE_SCHEMA_VERSION, 1);
	assert.equal(GRAPH_SSE_EVENT_NAME, "message");
	assert.equal(events.length, GRAPH_SSE_EVENT_TYPES.length);
	for (const event of events) assert.deepEqual(GraphSseEventSchema.parse(event), event);
});

test("graph update accepts migration warnings and normalizes legacy diffs", () => {
	const current = {
		...identity,
		seq: 2,
		type: "graph_updated",
		diff: {
			addedNodes: [],
			removedNodes: [],
			recoloredNodes: [],
			addedEdges: [],
			removedEdges: [],
			newCommunities: [],
			migrationWarnings: [{
				code: "identity_alignment_ambiguous",
				source_path: null,
			}],
			stats: { nodeCount: 1, edgeCount: 0, communityCount: 1 },
		},
		rebuiltAt: "2026-07-11T12:01:00.000Z",
		stats: { nodeCount: 1, edgeCount: 0 },
		warning_summary: warningSummary,
		warning_details_status: "available",
	} as const;
	assert.deepEqual(GraphSseEventSchema.parse(current), current);

	const legacy = structuredClone(current) as Record<string, any>;
	delete legacy.diff.migrationWarnings;
	const parsed = GraphSseEventSchema.parse(legacy);
	assert.deepEqual(parsed.diff?.migrationWarnings, []);
});

test("graph migration warnings reject absolute or escaping source paths", () => {
	for (const source_path of ["/Users/private/wiki/a.md", "../wiki/a.md", "wiki\\a.md"]) {
		const event = {
			...identity,
			seq: 2,
			type: "graph_updated",
			diff: {
				addedNodes: [],
				removedNodes: [],
				recoloredNodes: [],
				addedEdges: [],
				removedEdges: [],
				newCommunities: [],
				migrationWarnings: [{ code: "identity_alignment_ambiguous", source_path }],
				stats: { nodeCount: 1, edgeCount: 0, communityCount: 1 },
			},
			rebuiltAt: "2026-07-11T12:01:00.000Z",
			stats: { nodeCount: 1, edgeCount: 0 },
			warning_summary: warningSummary,
			warning_details_status: "available",
		};
		assert.equal(GraphSseEventSchema.safeParse(event).success, false, source_path);
	}
});

test("graph migration warnings reject internal comparison values and arbitrary legacy identifiers", () => {
	const base = {
		...identity,
		seq: 2,
		type: "graph_updated",
		diff: {
			addedNodes: [],
			removedNodes: [],
			recoloredNodes: [],
			addedEdges: [],
			removedEdges: [],
			newCommunities: [],
			migrationWarnings: [],
			stats: { nodeCount: 1, edgeCount: 0, communityCount: 1 },
		},
		rebuiltAt: "2026-07-11T12:01:00.000Z",
		stats: { nodeCount: 1, edgeCount: 0 },
		warning_summary: warningSummary,
		warning_details_status: "available",
	} as const;
	for (const warning of [{
		code: "identity_alignment_ambiguous",
		source_path: "wiki/safe.md",
		previous_ids: ["/Users/private", "C:\\private"],
		next_ids: ["portable-key:nfc|casefold", "arbitrary raw text"],
	}, {
		code: "legacy_semantic_edge_duplicate",
		semantic_key: "portable-key:nfc|casefold",
		previous_edge_ids: ["/Users/private"],
		next_edge_ids: ["C:\\private", "arbitrary raw text"],
	}]) {
		assert.equal(GraphSseEventSchema.safeParse({
			...base,
			diff: { ...base.diff, migrationWarnings: [warning] },
		}).success, false, warning.code);
	}
});

test("graph update requires warning summary and detail status", () => {
	const valid = {
		...identity,
		seq: 2,
		type: "graph_updated",
		diff: null,
		rebuiltAt: "2026-07-11T12:01:00.000Z",
		stats: { nodeCount: 1, edgeCount: 0 },
		warning_summary: null,
		warning_details_status: "unavailable",
	} as const;
	assert.equal(GraphSseEventSchema.safeParse(valid).success, true);
	for (const field of ["warning_summary", "warning_details_status"] as const) {
		const invalid = { ...valid } as Record<string, unknown>;
		delete invalid[field];
		assert.equal(GraphSseEventSchema.safeParse(invalid).success, false, field);
	}
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
