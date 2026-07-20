import assert from "node:assert/strict";
import test from "node:test";
import { SSEStreamingApi } from "hono/streaming";

import { GraphSseEventSchema, type GraphSseEvent } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import type { GraphEvent } from "./graph.js";
import type { GraphEventsRouteService } from "./routes/events.js";

interface SseFrame {
	event: string;
	data: string;
}

function createFakeService() {
	let nextStream = 0;
	let listener: ((event: GraphEvent) => void) | null = null;
	const calls = { subscribed: 0, unsubscribed: 0 };
	const service: GraphEventsRouteService = {
		createStreamId: () => `stream-${++nextStream}`,
		connectedAt: () => "2026-07-11T12:00:00.000Z",
		subscribe(next) {
			calls.subscribed += 1;
			listener = next;
			return () => {
				calls.unsubscribed += 1;
				listener = null;
			};
		},
	};
	return {
		service,
		calls,
		emit(event: GraphEvent) {
			listener?.(event);
		},
	};
}

test("graph stream starts with ready and keeps graph_error non-terminal", async () => {
	const fake = createFakeService();
	const controller = new AbortController();
	const res = await createApp({ graphEventsService: fake.service }).request("/api/events", undefined, {
		signal: controller.signal,
	});
	assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), true);
	const reader = res.body!.getReader();
	const first = await readFrames(reader, 1);
	assert.equal(first[0]?.event, "message");
	assert.equal(parse(first[0]!).type, "graph_stream_ready");

	fake.emit(graphError());
	fake.emit(graphUpdated());
	const later = await readFrames(reader, 2);
	const frames = [...first, ...later];
	assert.deepEqual(frames.map((frame) => parse(frame).type), [
		"graph_stream_ready",
		"graph_error",
		"graph_updated",
	]);
	for (const [index, frame] of frames.entries()) {
		const event = parse(frame);
		assert.equal(frame.event, "message");
		assert.equal(event.streamId, "stream-1");
		assert.equal(event.seq, index + 1);
	}

	controller.abort();
	await reader.cancel().catch(() => {});
	await tick();
	assert.equal(fake.calls.unsubscribed, 1);
});

test("a reconnect receives a new streamId and restarts seq at one", async () => {
	const fake = createFakeService();
	const app = createApp({ graphEventsService: fake.service });
	for (const expected of ["stream-1", "stream-2"]) {
		const controller = new AbortController();
		const res = await app.request("/api/events", undefined, { signal: controller.signal });
		const reader = res.body!.getReader();
		const [frame] = await readFrames(reader, 1);
		const ready = parse(frame!);
		assert.equal(ready.type, "graph_stream_ready");
		assert.equal(ready.streamId, expected);
		assert.equal(ready.seq, 1);
		controller.abort();
		await reader.cancel().catch(() => {});
		await tick();
	}
	assert.equal(fake.calls.subscribed, 2);
	assert.equal(fake.calls.unsubscribed, 2);
});

test("an abort before the ready frame finishes still completes the server stream", async () => {
	const fake = createFakeService();
	const originalClose = SSEStreamingApi.prototype.close;
	let closeCalls = 0;
	SSEStreamingApi.prototype.close = async function close() {
		closeCalls += 1;
		return originalClose.call(this);
	};
	try {
		const res = await createApp({ graphEventsService: fake.service }).request("/api/events");
		await res.body!.cancel();
		await waitFor(() => closeCalls === 1);
		assert.equal(fake.calls.unsubscribed, 1);
		assert.equal(closeCalls, 1);
	} finally {
		SSEStreamingApi.prototype.close = originalClose;
	}
});

function parse(frame: SseFrame): GraphSseEvent {
	return GraphSseEventSchema.parse(JSON.parse(frame.data));
}

function graphError(): GraphEvent {
	return {
		type: "graph_error",
		kbPath: "/fake/kb",
		message: "图谱重建失败",
		rebuiltAt: "2026-07-11T12:01:00.000Z",
	};
}

function graphUpdated(): GraphEvent {
	return {
		type: "graph_updated",
		kbPath: "/fake/kb",
		diff: null,
		rebuiltAt: "2026-07-11T12:02:00.000Z",
		stats: { nodeCount: 2, edgeCount: 1 },
		warning_summary: null,
		warning_details_status: "unavailable",
	};
}

async function readFrames(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	count: number,
): Promise<SseFrame[]> {
	const decoder = new TextDecoder();
	let buffer = "";
	const frames: SseFrame[] = [];
	while (frames.length < count) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		while (frames.length < count) {
			const boundary = /\r?\n\r?\n/.exec(buffer);
			if (!boundary || boundary.index === undefined) break;
			const block = buffer.slice(0, boundary.index);
			buffer = buffer.slice(boundary.index + boundary[0].length);
			let event = "message";
			const data: string[] = [];
			for (const line of block.split(/\r?\n/)) {
				if (line.startsWith("event:")) event = line.slice(6).trim();
				if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
			}
			frames.push({ event, data: data.join("\n") });
		}
	}
	return frames;
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 50;
	while (!predicate() && Date.now() < deadline) await tick();
}
