import {
	GRAPH_SSE_EVENT_NAME,
	GRAPH_SSE_EVENT_TYPES,
	GRAPH_SSE_READY_EVENT_TYPE,
	GRAPH_SSE_SCHEMA_VERSION,
	GraphSseEventSchema,
	type GraphSseEvent,
} from "@llm-wiki/workbench-contracts";

import {
	parseSseJson,
	RecoverableSseProtocolError,
	SseLifecycleGuard,
} from "./sse-contract";

export type GraphNotificationEvent = Exclude<
	GraphSseEvent,
	{ type: "graph_stream_ready" }
>;

export class GraphEventsProtocolError extends RecoverableSseProtocolError {
	constructor(message: string) {
		super(message);
		this.name = "GraphEventsProtocolError";
	}
}

export class GraphEventParser {
	private guard = createGraphGuard();

	parse(data: string): GraphSseEvent {
		const value = parseSseJson(data, protocolError);
		this.guard.accept(value, GRAPH_SSE_EVENT_NAME);
		const parsed = GraphSseEventSchema.safeParse(value);
		if (!parsed.success) throw protocolError("事件缺少必要字段或不符合契约");
		return parsed.data;
	}

	resetForReconnect(): void {
		this.guard = createGraphGuard();
	}
}

export interface EventSourceLike {
	onmessage: ((event: MessageEvent<string>) => void) | null;
	onerror: ((event: Event) => void) | null;
	close: () => void;
}

export interface GraphEventsSubscriptionOptions {
	onEvent: (event: GraphNotificationEvent) => void;
	onProtocolError?: (error: GraphEventsProtocolError) => void;
	eventSourceFactory?: (url: string) => EventSourceLike;
	reconnectDelayMs?: number;
}

export function subscribeGraphEvents(
	options: GraphEventsSubscriptionOptions,
): () => void {
	const createEventSource = options.eventSourceFactory ?? ((url: string) => (
		new EventSource(url) as unknown as EventSourceLike
	));
	const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
	let stopped = false;
	let source: EventSourceLike | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	const connect = () => {
		if (stopped) return;
		const parser = new GraphEventParser();
		const current = createEventSource("/api/events");
		source = current;
		current.onmessage = (message) => {
			if (stopped || source !== current) return;
			try {
				const event = parser.parse(message.data);
				if (event.type !== GRAPH_SSE_READY_EVENT_TYPE) options.onEvent(event);
			} catch (err) {
				const error = err instanceof GraphEventsProtocolError
					? err
					: protocolError("图谱更新流发生未知协议错误");
				options.onProtocolError?.(error);
				current.close();
				if (source === current) source = null;
				if (reconnectTimer !== null) clearTimeout(reconnectTimer);
				reconnectTimer = setTimeout(() => {
					reconnectTimer = null;
					connect();
				}, reconnectDelayMs);
			}
		};
		current.onerror = () => {
			// Native EventSource reconnects automatically. The server then sends a new
			// ready event with a new streamId and seq=1.
			parser.resetForReconnect();
		};
	};

	connect();
	return () => {
		stopped = true;
		if (reconnectTimer !== null) clearTimeout(reconnectTimer);
		reconnectTimer = null;
		source?.close();
		source = null;
	};
}

function createGraphGuard(): SseLifecycleGuard {
	return new SseLifecycleGuard({
		schemaVersion: GRAPH_SSE_SCHEMA_VERSION,
		eventTypes: GRAPH_SSE_EVENT_TYPES,
		identityFields: ["streamId"],
		requiredFirstEventType: GRAPH_SSE_READY_EVENT_TYPE,
		eventName: GRAPH_SSE_EVENT_NAME,
		error: protocolError,
	});
}

function protocolError(message: string): GraphEventsProtocolError {
	return new GraphEventsProtocolError(message);
}
