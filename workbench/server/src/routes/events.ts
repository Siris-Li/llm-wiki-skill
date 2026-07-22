import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
	GRAPH_SSE_SCHEMA_VERSION,
	GRAPH_SSE_EVENT_NAME,
	GRAPH_SSE_READY_EVENT_TYPE,
	GraphSseEventSchema,
	type GraphSseEvent,
} from "@llm-wiki/workbench-contracts";

import { subscribeGraphEvents, type GraphEvent } from "../graph.js";
import { HttpContractError } from "../http/request.js";
import { OrderedSseWriter } from "../tool-status-events.js";

export interface GraphEventsRouteService {
	createStreamId: () => string;
	connectedAt: () => string;
	subscribe: (kbPath: string, listener: (event: GraphEvent) => void) => () => void;
}

export function createGraphEventsRoutes(service: GraphEventsRouteService): Hono {
	const router = new Hono();

	router.get("/events", (c) => {
		const kbPath = c.req.query("kb");
		if (!kbPath) throw new HttpContractError("INVALID_REQUEST", "图谱事件流缺少知识库");
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
				const contractEvent = GraphSseEventSchema.parse({
					...projectGraphEvent(event),
					schemaVersion: GRAPH_SSE_SCHEMA_VERSION,
					streamId,
					seq: ++seq,
				}) as GraphSseEvent;
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
				unsubscribe = service.subscribe(kbPath, (event) => {
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
	subscribe: (kbPath, listener) => subscribeGraphEvents((event) => {
		if (event.kbPath === kbPath) listener(event);
	}),
};

function projectGraphEvent(
	event: GraphEvent | { type: typeof GRAPH_SSE_READY_EVENT_TYPE; connectedAt: string },
): Record<string, unknown> {
	if (event.type === GRAPH_SSE_READY_EVENT_TYPE) return event;
	if (event.type === "graph_error") {
		return {
			type: "graph_error",
			message: "图谱重建失败",
			rebuiltAt: event.rebuiltAt,
		};
	}
	return {
		type: "graph_updated",
		diff: event.diff ? projectGraphDiff(event.diff) : null,
		rebuiltAt: event.rebuiltAt,
		stats: event.stats,
		warning_summary: event.warning_summary,
		warning_details_status: event.warning_details_status,
	};
}

function projectGraphDiff(diff: NonNullable<Extract<GraphEvent, { type: "graph_updated" }>["diff"]>) {
	const migrationIdentifiers = new Set(diff.migrationWarnings.flatMap((warning) => (
		warning.code === "identity_alignment_ambiguous"
			? [...warning.previous_ids, ...warning.next_ids]
			: [...warning.previous_edge_ids, ...warning.next_edge_ids]
	)));
	const isPublicDiffIdentifier = (value: string) => (
		!migrationIdentifiers.has(value) && isSafeGraphIdentifier(value)
	);
	return {
		addedNodes: diff.addedNodes.filter(isPublicDiffIdentifier),
		removedNodes: diff.removedNodes.filter(isPublicDiffIdentifier),
		recoloredNodes: diff.recoloredNodes.filter((item) => (
			isPublicDiffIdentifier(item.id)
			&& isPublicDiffIdentifier(item.from)
			&& isPublicDiffIdentifier(item.to)
		)),
		addedEdges: diff.addedEdges.filter(isPublicDiffIdentifier),
		removedEdges: diff.removedEdges.filter(isPublicDiffIdentifier),
		newCommunities: diff.newCommunities.filter(isPublicDiffIdentifier),
		migrationWarnings: diff.migrationWarnings.map((warning) => (
			warning.code === "identity_alignment_ambiguous"
				? {
					code: warning.code,
					source_path: warning.source_path && isSafeRelativePath(warning.source_path)
						? warning.source_path
						: null,
				}
				: { code: warning.code }
		)),
		stats: diff.stats,
	};
}

function isSafeRelativePath(value: string): boolean {
	return Boolean(
		value
		&& !value.includes("\\")
		&& !value.startsWith("/")
		&& !/^[A-Za-z]:\//.test(value)
		&& value.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
	);
}

function isSafeGraphIdentifier(value: string): boolean {
	return isSafeRelativePath(value) || /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}
