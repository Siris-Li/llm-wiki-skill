import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	GraphSseEventSchema,
	type GraphSseEvent,
} from "@llm-wiki/workbench-contracts";

import {
	GraphEventParser,
	GraphEventsProtocolError,
	subscribeGraphEvents,
	type EventSourceLike,
} from "../src/lib/api/events";

describe("graph EventSource client", () => {
	it("accepts ready, graph_error, and later graph_updated with contiguous seq", () => {
		const parser = new GraphEventParser();
		const fixture = [
			event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }),
			event("graph_error", 2, { kbPath: "/fake/kb", message: "图谱重建失败", rebuiltAt: "2026-07-11T12:01:00.000Z" }),
			event("graph_updated", 3, { kbPath: "/fake/kb", diff: null, rebuiltAt: "2026-07-11T12:02:00.000Z", stats: { nodeCount: 2, edgeCount: 1 } }),
		];
		for (const item of fixture) GraphSseEventSchema.parse(item);
		assert.deepEqual(fixture.map((item) => parser.parse(JSON.stringify(item))), fixture);
	});

	it("resets identity and seq only after a transport reconnect", () => {
		const parser = new GraphEventParser();
		parser.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" })));
		assert.throws(
			() => parser.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:01:00.000Z" }, "stream-2"))),
			isRecoverableGraphError,
		);
		parser.resetForReconnect();
		const ready = event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:01:00.000Z" }, "stream-2");
		assert.deepEqual(parser.parse(JSON.stringify(ready)), ready);
	});

	it("rejects events before ready, unknown/version/missing fields, seq inversion, and identity changes", () => {
		const cases: Array<() => void> = [
			() => new GraphEventParser().parse(JSON.stringify(event("graph_error", 1, { kbPath: "/fake/kb", message: "失败", rebuiltAt: "2026-07-11T12:00:00.000Z" }))),
			() => new GraphEventParser().parse(JSON.stringify({ ...event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }), type: "unknown" })),
			() => new GraphEventParser().parse(JSON.stringify({ ...event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }), schemaVersion: 2 })),
			() => new GraphEventParser().parse(JSON.stringify({ ...event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }), streamId: undefined })),
			() => {
				const parser = readyParser();
				parser.parse(JSON.stringify(event("graph_error", 1, { kbPath: "/fake/kb", message: "失败", rebuiltAt: "2026-07-11T12:00:00.000Z" })));
			},
			() => {
				const parser = readyParser();
				parser.parse(JSON.stringify(event("graph_error", 2, { kbPath: "/fake/kb", message: "失败", rebuiltAt: "2026-07-11T12:00:00.000Z" }, "stream-2")));
			},
		];
		for (const run of cases) assert.throws(run, isRecoverableGraphError);
	});

	it("closes a corrupted connection, reconnects, and resumes typed events", async () => {
		const sources: FakeEventSource[] = [];
		const received: GraphSseEvent[] = [];
		const errors: Error[] = [];
		const close = subscribeGraphEvents({
			onEvent: (item) => received.push(item),
			onProtocolError: (error) => errors.push(error),
			reconnectDelayMs: 0,
			eventSourceFactory: () => {
				const source = new FakeEventSource();
				sources.push(source);
				return source;
			},
		});

		sources[0]!.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }));
		sources[0]!.emit({ ...event("graph_error", 2, { kbPath: "/fake/kb", message: "失败", rebuiltAt: "2026-07-11T12:01:00.000Z" }), type: "unknown" });
		await delay(5);
		assert.equal(errors.length, 1);
		assert.equal(sources[0]!.closed, true);
		assert.equal(sources.length, 2);

		sources[1]!.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:02:00.000Z" }, "stream-2"));
		const update = event("graph_updated", 2, { kbPath: "/fake/kb", diff: null, rebuiltAt: "2026-07-11T12:03:00.000Z", stats: { nodeCount: 2, edgeCount: 1 } }, "stream-2");
		sources[1]!.emit(update);
		assert.deepEqual(received, [update]);
		close();
		assert.equal(sources[1]!.closed, true);
	});

	it("accepts a new stream identity after native EventSource reconnects", () => {
		const sources: FakeEventSource[] = [];
		const received: GraphSseEvent[] = [];
		const close = subscribeGraphEvents({
			onEvent: (item) => received.push(item),
			eventSourceFactory: () => {
				const source = new FakeEventSource();
				sources.push(source);
				return source;
			},
		});
		const source = sources[0]!;
		source.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }));
		source.fail();
		source.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:01:00.000Z" }, "stream-2"));
		const update = event("graph_updated", 2, { kbPath: "/fake/kb", diff: null, rebuiltAt: "2026-07-11T12:02:00.000Z", stats: { nodeCount: 1, edgeCount: 0 } }, "stream-2");
		source.emit(update);
		assert.deepEqual(received, [update]);
		close();
	});
});

class FakeEventSource implements EventSourceLike {
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	closed = false;

	emit(value: unknown): void {
		this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>);
	}

	fail(): void {
		this.onerror?.(new Event("error"));
	}

	close(): void {
		this.closed = true;
	}
}

function readyParser(): GraphEventParser {
	const parser = new GraphEventParser();
	parser.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" })));
	return parser;
}

function event(
	type: GraphSseEvent["type"],
	seq: number,
	extra: Record<string, unknown>,
	streamId = "stream-1",
): GraphSseEvent {
	return { schemaVersion: 1, streamId, seq, type, ...extra } as GraphSseEvent;
}

function isRecoverableGraphError(error: unknown): boolean {
	return error instanceof GraphEventsProtocolError && error.recoverable;
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
