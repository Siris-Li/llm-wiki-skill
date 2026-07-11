import {
	ArtifactCreatedPromptEventSchema,
	AssistantCancelledEventSchema,
	AssistantDoneEventSchema,
	AssistantErrorEventSchema,
	FailureEnvelopeSchema,
	PROMPT_SSE_EVENT_TYPES,
	PROMPT_SSE_SCHEMA_VERSION,
	PromptRequestBodySchema,
	ToolStatusEndEventSchema,
	ToolStatusStartEventSchema,
	ToolStatusSummaryEventSchema,
	ToolStatusUpdateEventSchema,
	isPromptTerminalEvent,
	type PromptSseEvent,
} from "@llm-wiki/workbench-contracts";

import { parseSSE } from "../sse";
import { ApiError } from "./client";

const PROMPT_EVENT_TYPES = new Set<string>(PROMPT_SSE_EVENT_TYPES);

export class PromptProtocolError extends Error {
	readonly recoverable = true;

	constructor(message: string) {
		super(message);
		this.name = "PromptProtocolError";
	}
}

export async function streamPrompt(
	message: string,
	signal?: AbortSignal,
): Promise<AsyncGenerator<PromptSseEvent, void, undefined>> {
	const body = PromptRequestBodySchema.parse({ message });
	const response = await fetch("/api/prompt", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new PromptProtocolError("启动请求失败，响应不符合统一错误契约");
		}
		const failure = FailureEnvelopeSchema.safeParse(payload);
		if (!failure.success) {
			throw new PromptProtocolError("启动请求失败，响应不符合统一错误契约");
		}
		throw new ApiError(failure.data);
	}
	if (!response.body) {
		throw new PromptProtocolError("回复流缺少响应内容");
	}
	return parsePromptEvents(response.body);
}

export async function* parsePromptEvents(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<PromptSseEvent, void, undefined> {
	let expectedSeq = 1;
	let runId: string | null = null;
	let messageId: string | null = null;
	let terminalSeen = false;

	for await (const message of parseSSE(stream)) {
		if (terminalSeen) throw new PromptProtocolError("回复流在结束事件后仍包含事件");

		let value: unknown;
		try {
			value = JSON.parse(message.data);
		} catch {
			throw new PromptProtocolError("回复流包含无法解析的事件数据");
		}
		const event = parsePromptEvent(value, message.event);
		if (event.seq !== expectedSeq) {
			throw new PromptProtocolError(`回复流序号不连续：期待 ${expectedSeq}，收到 ${event.seq}`);
		}
		if (runId === null) {
			runId = event.runId;
			messageId = event.messageId;
		} else if (event.runId !== runId || event.messageId !== messageId) {
			throw new PromptProtocolError("回复流事件身份在同一请求中发生变化");
		}
		expectedSeq += 1;
		terminalSeen = isPromptTerminalEvent(event);
		yield event;
	}

	if (!terminalSeen) throw new PromptProtocolError("回复流提前结束，缺少结束事件");
}

function parsePromptEvent(value: unknown, eventName: string): PromptSseEvent {
	if (!isRecord(value)) throw new PromptProtocolError("回复流事件必须是 JSON 对象");
	if (value.schemaVersion !== PROMPT_SSE_SCHEMA_VERSION) {
		throw new PromptProtocolError("回复流事件 schemaVersion 不受支持");
	}
	if (typeof value.type !== "string" || !PROMPT_EVENT_TYPES.has(value.type)) {
		throw new PromptProtocolError("回复流包含未知事件类型");
	}
	if (value.type !== eventName) throw new PromptProtocolError("回复流事件名称与 data.type 不一致");
	if (typeof value.runId !== "string" || value.runId.length === 0) {
		throw new PromptProtocolError("回复流事件缺少 runId");
	}
	if (typeof value.messageId !== "string" || value.messageId.length === 0) {
		throw new PromptProtocolError("回复流事件缺少 messageId");
	}
	if (!Number.isInteger(value.seq) || (value.seq as number) < 1) {
		throw new PromptProtocolError("回复流事件 seq 无效");
	}
	if (value.type === "assistant_text_delta") {
		if (typeof value.delta !== "string") {
			throw new PromptProtocolError("文本增量事件缺少 delta");
		}
		return value as PromptSseEvent;
	}
	const schema = promptEventSchema(
		value.type as Exclude<PromptSseEvent["type"], "assistant_text_delta">,
	);
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new PromptProtocolError("回复流事件缺少必要字段或不符合契约");
	}
	return parsed.data;
}

function promptEventSchema(type: Exclude<PromptSseEvent["type"], "assistant_text_delta">) {
	switch (type) {
		case "tool_status_start":
			return ToolStatusStartEventSchema;
		case "tool_status_update":
			return ToolStatusUpdateEventSchema;
		case "tool_status_end":
			return ToolStatusEndEventSchema;
		case "tool_status_summary":
			return ToolStatusSummaryEventSchema;
		case "artifact_created":
			return ArtifactCreatedPromptEventSchema;
		case "assistant_done":
			return AssistantDoneEventSchema;
		case "assistant_cancelled":
			return AssistantCancelledEventSchema;
		case "assistant_error":
			return AssistantErrorEventSchema;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
