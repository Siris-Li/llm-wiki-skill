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
		const reused = new GraphEventParser();
		reused.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" })));
		reused.resetForReconnect();
		assert.throws(
			() => reused.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:01:00.000Z" }))),
			isRecoverableGraphError,
		);

		const parser = new GraphEventParser();
		parser.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" })));
		assert.throws(
			() => parser.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:01:00.000Z" }, "stream-2"))),
			isRecoverableGraphError,
		);
		parser.resetForReconnect();
		const ready = event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:01:00.000Z" }, "stream-2");
		assert.deepEqual(parser.parse(JSON.stringify(ready)), ready);
		parser.resetForReconnect();
		assert.throws(
			() => parser.parse(JSON.stringify(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:02:00.000Z" }))),
			isRecoverableGraphError,
		);
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

	it("rejects a reused stream identity after reconnecting a corrupted connection", async () => {
		const sources: FakeEventSource[] = [];
		const errors: Error[] = [];
		const close = subscribeGraphEvents({
			onEvent: () => {},
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
		assert.equal(sources.length, 2);

		sources[1]!.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:02:00.000Z" }));
		await delay(5);
		assert.equal(errors.length, 2);
		assert.equal(sources[1]!.closed, true);
		assert.equal(sources.length, 3);

		close();
		assert.equal(sources[2]!.closed, true);
	});

	it("stops delivering or reconnecting after the caller closes the subscription", async () => {
		const sources: FakeEventSource[] = [];
		const received: GraphSseEvent[] = [];
		const close = subscribeGraphEvents({
			onEvent: (event) => received.push(event),
			reconnectDelayMs: 0,
			eventSourceFactory: () => {
				const source = new FakeEventSource();
				sources.push(source);
				return source;
			},
		});

		const source = sources[0]!;
		source.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }));
		close();
		source.emit(event("graph_updated", 2, { kbPath: "/fake/kb", diff: null, rebuiltAt: "2026-07-11T12:01:00.000Z", stats: { nodeCount: 1, edgeCount: 0 } }));
		source.fail();
		await delay(5);

		assert.deepEqual(received, []);
		assert.equal(source.closed, true);
		assert.equal(sources.length, 1);
	});

	it("does not schedule a reconnect after the error callback closes the subscription", () => {
		const originalSetTimeout = globalThis.setTimeout;
		let scheduled = 0;
		globalThis.setTimeout = (() => {
			scheduled += 1;
			return {} as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout;
		try {
			const sources: FakeEventSource[] = [];
			const close = subscribeGraphEvents({
				onEvent: () => {},
				onProtocolError: () => close(),
				eventSourceFactory: () => {
					const source = new FakeEventSource();
					sources.push(source);
					return source;
				},
			});

			sources[0]!.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:00:00.000Z" }));
			sources[0]!.emit({ ...event("graph_error", 2, { kbPath: "/fake/kb", message: "失败", rebuiltAt: "2026-07-11T12:01:00.000Z" }), type: "unknown" });

			assert.equal(sources[0]!.closed, true);
			assert.equal(scheduled, 0);
		} finally {
			globalThis.setTimeout = originalSetTimeout;
		}
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

	it("reports reconnect readiness once without treating the initial ready as graph state", () => {
		const sources: FakeEventSource[] = [];
		const readyStates: Array<{ streamId: string; reconnected: boolean }> = [];
		const close = subscribeGraphEvents({
			onEvent: () => {},
			onReady: (ready, context) => readyStates.push({
				streamId: ready.streamId,
				reconnected: context.reconnected,
			}),
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

		assert.deepEqual(readyStates, [
			{ streamId: "stream-1", reconnected: false },
			{ streamId: "stream-2", reconnected: true },
		]);
		close();
	});

	it("ignores terminal events from a replaced connection after the new stream is ready", async () => {
		const sources: FakeEventSource[] = [];
		const received: GraphSseEvent[] = [];
		const close = subscribeGraphEvents({
			onEvent: (item) => received.push(item),
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
		sources[1]!.emit(event("graph_stream_ready", 1, { connectedAt: "2026-07-11T12:02:00.000Z" }, "stream-2"));
		sources[0]!.emit(event("graph_error", 3, { kbPath: "/fake/kb", message: "旧连接失败", rebuiltAt: "2026-07-11T12:03:00.000Z" }));
		const current = event("graph_updated", 2, { kbPath: "/fake/kb", diff: null, rebuiltAt: "2026-07-11T12:04:00.000Z", stats: { nodeCount: 2, edgeCount: 1 } }, "stream-2");
		sources[1]!.emit(current);

		assert.deepEqual(received, [current]);
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
