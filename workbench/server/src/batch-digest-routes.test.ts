import assert from "node:assert/strict";
import test from "node:test";

import {
	BatchDigestSseEventSchema,
	isBatchDigestTerminalEvent,
	type BatchDigestSseEvent,
} from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import type { BatchDigestEvent } from "./digest/batch.js";
import type { BatchDigestRouteService } from "./routes/batch-digest.js";

interface SseFrame {
	event: string;
	data: string;
}

type Behavior = "success" | "file-failure" | "failure" | "cancel" | "empty" | "late-event";

function createFakeService(behavior: Behavior = "success") {
	const calls = {
		runs: 0,
		suspended: [] as string[],
		resumed: [] as Array<[string, boolean]>,
		signals: [] as AbortSignal[],
	};
	const service: BatchDigestRouteService = {
		createRunId: () => "run-fixed",
		createBatchId: () => "batch-fixed",
		suspendGraphWatcher(kbPath) {
			calls.suspended.push(kbPath);
		},
		resumeGraphWatcher(kbPath, options) {
			calls.resumed.push([kbPath, options.trigger === true]);
		},
		async runBatchDigest(_input, emit, signal) {
			calls.runs += 1;
			calls.signals.push(signal);
			if (behavior === "failure") throw new Error("ENOENT /Users/private/secret");
			if (behavior === "cancel") throw new DOMException("aborted", "AbortError");
			if (behavior === "empty") return;
			await emit(raw("start"));
			await emit(raw("file_start"));
			if (behavior === "file-failure") {
				await emit(raw("file_error"));
				await emit(raw("done", { completed: 0, failed: 1 }));
				return;
			}
			await emit(raw("file_progress"));
			await emit(raw("file_complete"));
			await emit(raw("done"));
			if (behavior === "late-event") await emit(raw("file_progress"));
		},
	};
	return { service, calls };
}

test("batch digest rejects invalid JSON and invalid fields before starting SSE", async () => {
	const { service, calls } = createFakeService();
	const app = createApp({ batchDigestService: service });
	for (const body of ["{bad", { kbPath: "/fake/kb", filePaths: [], secret: "nope" }]) {
		const res = await app.request("/api/knowledge-bases/batch-digest", post(body));
		assert.equal(res.status, 400);
		const payload = await res.json() as { code: string };
		assert.ok(["INVALID_JSON", "INVALID_REQUEST"].includes(payload.code));
		assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), false);
	}
	assert.equal(calls.runs, 0);
});

test("batch digest success has stable identity, contiguous seq, and one terminal", async () => {
	const { service, calls } = createFakeService();
	const app = createApp({ batchDigestService: service });
	const frames = await requestFrames(app);
	assertBatchLifecycle(frames);
	assert.deepEqual(frames.map((frame) => frame.event), [
		"batch_started",
		"batch_file_started",
		"batch_file_progress",
		"batch_file_completed",
		"batch_completed",
	]);
	assert.deepEqual(calls.suspended, ["/fake/kb"]);
	assert.deepEqual(calls.resumed, [["/fake/kb", true]]);
});

test("single-file failure stays non-terminal and is followed by batch_completed", async () => {
	const { service } = createFakeService("file-failure");
	const frames = await requestFrames(createApp({ batchDigestService: service }));
	assertBatchLifecycle(frames);
	assert.deepEqual(frames.map((frame) => frame.event), [
		"batch_started",
		"batch_file_started",
		"batch_file_failed",
		"batch_completed",
	]);
	const completed = JSON.parse(frames.at(-1)!.data) as BatchDigestSseEvent;
	assert.equal(completed.type, "batch_completed");
	if (completed.type === "batch_completed") assert.equal(completed.failed, 1);
});

test("overall failure and cancellation produce safe, unique terminal events", async () => {
	for (const [behavior, terminal] of [
		["failure", "batch_failed"],
		["cancel", "batch_cancelled"],
	] as const) {
		const { service, calls } = createFakeService(behavior);
		const frames = await requestFrames(createApp({ batchDigestService: service }));
		assertBatchLifecycle(frames);
		assert.equal(frames.length, 1);
		assert.equal(frames[0]!.event, terminal);
		assert.equal(frames[0]!.data.includes("/Users/"), false);
		assert.deepEqual(calls.resumed, [["/fake/kb", false]]);
	}
});

test("route fills a missing terminal and drops events after a terminal", async () => {
	for (const [behavior, expected] of [
		["empty", ["batch_failed"]],
		[
			"late-event",
			[
				"batch_started",
				"batch_file_started",
				"batch_file_progress",
				"batch_file_completed",
				"batch_completed",
			],
		],
	] as const) {
		const { service } = createFakeService(behavior);
		const frames = await requestFrames(createApp({ batchDigestService: service }));
		assertBatchLifecycle(frames);
		assert.deepEqual(frames.map((frame) => frame.event), expected);
	}
});

test("transport abort passes cancellation to the service and resumes the graph watcher", async () => {
	let started!: () => void;
	const startedPromise = new Promise<void>((resolve) => { started = resolve; });
	const { service, calls } = createFakeService();
	service.runBatchDigest = async (_input, _emit, signal) => {
		calls.runs += 1;
		calls.signals.push(signal);
		started();
		await new Promise<void>((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
		});
	};
	const controller = new AbortController();
	const app = createApp({ batchDigestService: service });
	const res = await app.request("/api/knowledge-bases/batch-digest", post(validBody()), {
		signal: controller.signal,
	});
	const reader = res.body!.getReader();
	await startedPromise;
	controller.abort();
	await reader.cancel().catch(() => {});
	await tick();
	assert.equal(calls.signals[0]?.aborted, true);
	assert.deepEqual(calls.resumed, [["/fake/kb", false]]);
});

function raw(type: BatchDigestEvent["type"], overrides: Record<string, unknown> = {}): BatchDigestEvent {
	const values: Record<BatchDigestEvent["type"], BatchDigestEvent> = {
		start: { type: "start", total: 1, concurrency: 3, outputDir: "/fake/output" },
		file_start: { type: "file_start", index: 0, filePath: "/fake/a.md" },
		file_progress: { type: "file_progress", index: 0, filePath: "/fake/a.md", chars: 500 },
		file_complete: { type: "file_complete", index: 0, filePath: "/fake/a.md", outputPath: "/fake/output/a.md" },
		file_error: { type: "file_error", index: 0, filePath: "/fake/a.md", error: "文件处理失败" },
		done: { type: "done", total: 1, completed: 1, failed: 0, outputDir: "/fake/output" },
	};
	return { ...values[type], ...overrides } as BatchDigestEvent;
}

function assertBatchLifecycle(frames: SseFrame[]): void {
	assert.ok(frames.length > 0);
	let terminals = 0;
	for (const [index, frame] of frames.entries()) {
		const event = BatchDigestSseEventSchema.parse(JSON.parse(frame.data));
		assert.equal(frame.event, event.type);
		assert.equal(event.schemaVersion, 1);
		assert.equal(event.runId, "run-fixed");
		assert.equal(event.batchId, "batch-fixed");
		assert.equal(event.seq, index + 1);
		if (isBatchDigestTerminalEvent(event)) terminals += 1;
	}
	assert.equal(terminals, 1);
	assert.equal(isBatchDigestTerminalEvent(JSON.parse(frames.at(-1)!.data)), true);
}

async function requestFrames(app: ReturnType<typeof createApp>): Promise<SseFrame[]> {
	const res = await app.request("/api/knowledge-bases/batch-digest", post(validBody()));
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), true);
	return readSse(await res.text());
}

function validBody() {
	return { kbPath: "/fake/kb", filePaths: ["/fake/a.md"], concurrency: 3 as const };
}

function post(body: unknown): RequestInit {
	return {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	};
}

function readSse(text: string): SseFrame[] {
	return text.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
		let event = "message";
		const data: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith("event:")) event = line.slice(6).trim();
			if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
		}
		return { event, data: data.join("\n") };
	});
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
