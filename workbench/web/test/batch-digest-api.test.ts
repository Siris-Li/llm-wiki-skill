import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
	BatchDigestSseEventSchema,
	type BatchDigestSseEvent,
} from "@llm-wiki/workbench-contracts";

import {
	BatchDigestProtocolError,
	parseBatchDigestEvents,
	streamBatchDigest,
} from "../src/lib/api/batch-digest";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("batch digest SSE client", () => {
	it("parses success and single-file failure fixtures through the shared schema", async () => {
		for (const fixture of [
			[
				event("batch_started", 1, { total: 1, concurrency: 3, outputDir: "/fake/output" }),
				event("batch_file_started", 2, { index: 0, filePath: "/fake/a.md" }),
				event("batch_file_completed", 3, { index: 0, filePath: "/fake/a.md", outputPath: "/fake/output/a.md" }),
				event("batch_completed", 4, { total: 1, completed: 1, failed: 0, outputDir: "/fake/output" }),
			],
			[
				event("batch_started", 1, { total: 1, concurrency: 3, outputDir: "/fake/output" }),
				event("batch_file_started", 2, { index: 0, filePath: "/fake/a.md" }),
				event("batch_file_failed", 3, { index: 0, filePath: "/fake/a.md", message: "文件处理失败" }),
				event("batch_completed", 4, { total: 1, completed: 0, failed: 1, outputDir: "/fake/output" }),
			],
		] as const) {
			for (const item of fixture) BatchDigestSseEventSchema.parse(item);
			assert.deepEqual(await collect(parseBatchDigestEvents(sseStream(fixture))), fixture);
		}
	});

	it("accepts overall failure and cancellation as terminal events", async () => {
		for (const terminal of [
			event("batch_failed", 1, { code: "INTERNAL_ERROR", message: "批量消化失败" }),
			event("batch_cancelled", 1, { reason: "批量消化已取消" }),
		]) {
			assert.deepEqual(await collect(parseBatchDigestEvents(sseStream([terminal]))), [terminal]);
		}
	});

	it("turns a non-2xx failure envelope into the shared API error", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ ok: false, code: "INVALID_REQUEST", message: "请求无效" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			})) as typeof fetch;
		await assert.rejects(streamBatchDigest({ kbPath: "/fake/kb", filePaths: ["/fake/a.md"] }), {
			name: "ApiError",
			message: "请求无效",
		});
	});

	it("preserves AbortError when the caller cancels the request", async () => {
		globalThis.fetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			})) as typeof fetch;
		const controller = new AbortController();
		const request = streamBatchDigest(
			{ kbPath: "/fake/kb", filePaths: ["/fake/a.md"] },
			controller.signal,
		);
		controller.abort();
		await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === "AbortError");
	});

	it("surfaces a transport read failure so the caller can restore the job state", async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const started = event("batch_started", 1, {
					total: 1,
					concurrency: 3,
					outputDir: "/fake/output",
				});
				controller.enqueue(
					encoder.encode(`event: ${started.type}\ndata: ${JSON.stringify(started)}\n\n`),
				);
				controller.error(new TypeError("network connection lost"));
			},
		});
		await assert.rejects(
			collect(parseBatchDigestEvents(stream)),
			(error: unknown) => error instanceof TypeError && error.message === "network connection lost",
		);
	});

	it("rejects unknown, unsupported, and missing-field events as recoverable", async () => {
		for (const invalid of [
			{ ...event("batch_cancelled", 1, { reason: "取消" }), type: "unknown_event" },
			{ ...event("batch_cancelled", 1, { reason: "取消" }), schemaVersion: 2 },
			{ ...event("batch_cancelled", 1, { reason: "取消" }), batchId: undefined },
			{ ...event("batch_file_started", 1, { index: 0, filePath: "/fake/a.md" }), filePath: undefined },
		]) {
			await assert.rejects(
				collect(parseBatchDigestEvents(sseStream([invalid as BatchDigestSseEvent]))),
				isRecoverableBatchError,
			);
		}
	});

	it("cancels the underlying response body after a protocol error", async () => {
		let cancelled = false;
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const invalid = {
					...event("batch_cancelled", 1, { reason: "取消" }),
					type: "unknown_event",
				};
				controller.enqueue(
					encoder.encode(`event: unknown_event\ndata: ${JSON.stringify(invalid)}\n\n`),
				);
			},
			cancel() {
				cancelled = true;
			},
		});
		await assert.rejects(collect(parseBatchDigestEvents(stream)), isRecoverableBatchError);
		assert.equal(cancelled, true);
	});

	for (const [name, fixture] of [
		["first seq is not one", [event("batch_cancelled", 2, { reason: "取消" })]],
		["seq regresses", [event("batch_started", 1, { total: 1, concurrency: 3, outputDir: "/fake/output" }), event("batch_cancelled", 1, { reason: "取消" })]],
		["identity changes", [event("batch_started", 1, { total: 1, concurrency: 3, outputDir: "/fake/output" }), event("batch_cancelled", 2, { reason: "取消" }, "run-2")]],
		["event follows terminal", [event("batch_cancelled", 1, { reason: "取消" }), event("batch_cancelled", 2, { reason: "再次取消" })]],
		["transport disconnects before terminal", [event("batch_started", 1, { total: 1, concurrency: 3, outputDir: "/fake/output" })]],
	] as const) {
		it(`rejects ${name} with the same recoverable lifecycle policy`, async () => {
			await assert.rejects(collect(parseBatchDigestEvents(sseStream(fixture))), isRecoverableBatchError);
		});
	}
});

function event(
	type: BatchDigestSseEvent["type"],
	seq: number,
	extra: Record<string, unknown>,
	runId = "run-1",
): BatchDigestSseEvent {
	return {
		schemaVersion: 1,
		runId,
		batchId: "batch-1",
		seq,
		type,
		...extra,
	} as BatchDigestSseEvent;
}

function sseStream(events: readonly BatchDigestSseEvent[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const item of events) {
				controller.enqueue(encoder.encode(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`));
			}
			controller.close();
		},
	});
}

function isRecoverableBatchError(error: unknown): boolean {
	return error instanceof BatchDigestProtocolError && error.recoverable;
}

async function collect<T>(stream: AsyncGenerator<T, void, undefined>): Promise<T[]> {
	const values: T[] = [];
	for await (const value of stream) values.push(value);
	return values;
}
