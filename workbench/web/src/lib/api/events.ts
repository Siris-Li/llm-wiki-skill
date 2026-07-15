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
	private readonly seenStreamIds = new Set<string>();

	parse(data: string): GraphSseEvent {
		const value = parseSseJson(data, protocolError);
		this.guard.accept(value, GRAPH_SSE_EVENT_NAME);
		const parsed = GraphSseEventSchema.safeParse(value);
		if (!parsed.success) throw protocolError("事件缺少必要字段或不符合契约");
		if (
			parsed.data.type === GRAPH_SSE_READY_EVENT_TYPE &&
			this.seenStreamIds.has(parsed.data.streamId)
		) {
			throw protocolError("图谱重连后 streamId 已被使用");
		}
		if (parsed.data.type === GRAPH_SSE_READY_EVENT_TYPE) {
			this.seenStreamIds.add(parsed.data.streamId);
		}
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
	onReady?: (
		event: Extract<GraphSseEvent, { type: "graph_stream_ready" }>,
		context: { reconnected: boolean },
	) => void;
	onProtocolError?: (error: GraphEventsProtocolError) => void;
	eventSourceFactory?: (url: string) => EventSourceLike;
	connectivityTarget?: EventTarget;
	reconnectDelayMs?: number;
}

export function subscribeGraphEvents(
	options: GraphEventsSubscriptionOptions,
): () => void {
	const createEventSource = options.eventSourceFactory ?? ((url: string) => (
		new EventSource(url) as unknown as EventSourceLike
	));
	const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
	const connectivityTarget = options.connectivityTarget
		?? (typeof window === "undefined" ? null : window);
	let stopped = false;
	let offline = false;
	let source: EventSourceLike | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let nextReadyIsReconnect = false;
	const parser = new GraphEventParser();
	const markDisconnected = () => {
		nextReadyIsReconnect = true;
		parser.resetForReconnect();
	};

	const connect = () => {
		if (stopped || offline || source) return;
		const current = createEventSource("/api/events");
		source = current;
		current.onmessage = (message) => {
			if (stopped || source !== current) return;
			try {
				const event = parser.parse(message.data);
				if (event.type === GRAPH_SSE_READY_EVENT_TYPE) {
					options.onReady?.(event, { reconnected: nextReadyIsReconnect });
					nextReadyIsReconnect = false;
				} else {
					options.onEvent(event);
				}
			} catch (err) {
				const error = err instanceof GraphEventsProtocolError
					? err
					: protocolError("图谱更新流发生未知协议错误");
				options.onProtocolError?.(error);
				if (stopped || source !== current) return;
				markDisconnected();
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
			if (stopped || source !== current) return;
			// Native EventSource reconnects automatically. The server then sends a new
			// ready event with a new streamId and seq=1.
			markDisconnected();
		};
	};

	const handleOffline = () => {
		if (stopped || offline) return;
		offline = true;
		markDisconnected();
		if (reconnectTimer !== null) clearTimeout(reconnectTimer);
		reconnectTimer = null;
		const current = source;
		source = null;
		current?.close();
	};
	const handleOnline = () => {
		if (stopped || !offline) return;
		offline = false;
		connect();
	};
	connectivityTarget?.addEventListener("offline", handleOffline);
	connectivityTarget?.addEventListener("online", handleOnline);
	connect();
	return () => {
		stopped = true;
		connectivityTarget?.removeEventListener("offline", handleOffline);
		connectivityTarget?.removeEventListener("online", handleOnline);
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
