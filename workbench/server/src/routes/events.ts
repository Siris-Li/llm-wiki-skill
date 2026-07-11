import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
	GRAPH_SSE_SCHEMA_VERSION,
	GRAPH_SSE_EVENT_NAME,
	GRAPH_SSE_READY_EVENT_TYPE,
	type GraphSseEvent,
} from "@llm-wiki/workbench-contracts";

import { subscribeGraphEvents, type GraphEvent } from "../graph.js";
import { OrderedSseWriter } from "../tool-status-events.js";

export interface GraphEventsRouteService {
	createStreamId: () => string;
	connectedAt: () => string;
	subscribe: (listener: (event: GraphEvent) => void) => () => void;
}

export function createGraphEventsRoutes(service: GraphEventsRouteService): Hono {
	const router = new Hono();

	router.get("/events", (c) => {
		return streamSSE(c, async (stream) => {
			const streamId = service.createStreamId();
			let seq = 0;
			let closed = false;
			let unsubscribe: (() => void) | undefined;
			const rawWriter = new OrderedSseWriter(async (payload) => {
				await stream.writeSSE(payload);
			});
			const write = (event: GraphEvent | { type: typeof GRAPH_SSE_READY_EVENT_TYPE; connectedAt: string }) => {
				if (closed) return Promise.resolve();
				const contractEvent = {
					...event,
					schemaVersion: GRAPH_SSE_SCHEMA_VERSION,
					streamId,
					seq: ++seq,
				} as GraphSseEvent;
				// A single EventSource channel lets the client validate unknown data.type values.
				return rawWriter.writeNamed(GRAPH_SSE_EVENT_NAME, contractEvent);
			};
			const cleanup = () => {
				if (closed) return;
				closed = true;
				rawWriter.close();
				unsubscribe?.();
			};
			const aborted = new Promise<void>((resolve) => {
				stream.onAbort(() => {
					cleanup();
					resolve();
				});
			});

			try {
				const readyWrite = write({
					type: GRAPH_SSE_READY_EVENT_TYPE,
					connectedAt: service.connectedAt(),
				});
				unsubscribe = service.subscribe((event) => {
					void write(event).catch(() => stream.abort());
				});
				await readyWrite;
				await aborted;
			} finally {
				cleanup();
			}
		});
	});

	return router;
}

export const defaultGraphEventsRouteService: GraphEventsRouteService = {
	createStreamId: () => `graph-stream-${randomUUID()}`,
	connectedAt: () => new Date().toISOString(),
	subscribe: subscribeGraphEvents,
};
