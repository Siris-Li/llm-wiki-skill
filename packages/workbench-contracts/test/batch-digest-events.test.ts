import assert from "node:assert/strict";
import test from "node:test";

import {
	BATCH_DIGEST_SSE_EVENT_TYPES,
	BATCH_DIGEST_SSE_SCHEMA_VERSION,
	BatchDigestRequestBodySchema,
	BatchDigestSseEventSchema,
	isBatchDigestTerminalEvent,
} from "../src/index.js";

const identity = {
	schemaVersion: 1,
	runId: "run-1",
	batchId: "batch-1",
} as const;

test("batch digest request body uses the shared strict schema", () => {
	assert.deepEqual(
		BatchDigestRequestBodySchema.parse({
			kbPath: "/fake/kb",
			filePaths: ["/fake/a.md"],
			concurrency: 3,
			sourceScanId: "scan-1",
			digestModel: { provider: "openai", modelId: "gpt-test" },
		}),
		{
			kbPath: "/fake/kb",
			filePaths: ["/fake/a.md"],
			concurrency: 3,
			sourceScanId: "scan-1",
			digestModel: { provider: "openai", modelId: "gpt-test" },
		},
	);

	for (const invalid of [
		{ kbPath: "", filePaths: ["/fake/a.md"] },
		{ kbPath: "/fake/kb", filePaths: [] },
		{ kbPath: "/fake/kb", filePaths: ["/fake/a.md"], concurrency: 2 },
		{ kbPath: "/fake/kb", filePaths: ["/fake/a.md"], secret: "nope" },
	]) {
		assert.equal(BatchDigestRequestBodySchema.safeParse(invalid).success, false);
	}
});

test("batch digest SSE schema validates every public event", () => {
	const events = [
		{
			...identity,
			seq: 1,
			type: "batch_started",
			total: 2,
			concurrency: 3,
			outputDir: "/fake/kb/wiki/synthesis/sessions",
		},
		{
			...identity,
			seq: 2,
			type: "batch_file_started",
			index: 0,
			filePath: "/fake/a.md",
		},
		{
			...identity,
			seq: 3,
			type: "batch_file_progress",
			index: 0,
			filePath: "/fake/a.md",
			chars: 500,
		},
		{
			...identity,
			seq: 4,
			type: "batch_file_completed",
			index: 0,
			filePath: "/fake/a.md",
			outputPath: "/fake/kb/wiki/synthesis/sessions/a.md",
		},
		{
			...identity,
			seq: 5,
			type: "batch_file_failed",
			index: 1,
			filePath: "/fake/b.md",
			message: "文件处理失败",
		},
		{
			...identity,
			seq: 6,
			type: "batch_completed",
			total: 2,
			completed: 1,
			failed: 1,
			outputDir: "/fake/kb/wiki/synthesis/sessions",
		},
		{
			...identity,
			seq: 6,
			type: "batch_cancelled",
			reason: "用户已取消",
		},
		{
			...identity,
			seq: 6,
			type: "batch_failed",
			code: "INTERNAL_ERROR",
			message: "批量消化失败",
			details: { diagnosticId: "safe-id" },
		},
	] as const;

	assert.equal(BATCH_DIGEST_SSE_SCHEMA_VERSION, 1);
	assert.equal(events.length, BATCH_DIGEST_SSE_EVENT_TYPES.length);
	for (const event of events) {
		assert.deepEqual(BatchDigestSseEventSchema.parse(event), event);
	}
	assert.equal(isBatchDigestTerminalEvent(events[4]), false);
	for (const event of events.slice(5)) {
		assert.equal(isBatchDigestTerminalEvent(event), true);
	}
});

test("batch digest SSE schema rejects drift in version, identity, sequence, and type", () => {
	const valid = {
		...identity,
		seq: 1,
		type: "batch_cancelled",
		reason: "用户已取消",
	} as const;
	for (const invalid of [
		{ ...valid, schemaVersion: 2 },
		{ ...valid, runId: "" },
		{ ...valid, batchId: undefined },
		{ ...valid, seq: 0 },
		{ ...valid, type: "unknown_event" },
		{ ...valid, extra: true },
	]) {
		assert.equal(BatchDigestSseEventSchema.safeParse(invalid).success, false);
	}
});
