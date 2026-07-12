import {
	BATCH_DIGEST_SSE_EVENT_TYPES,
	BATCH_DIGEST_SSE_SCHEMA_VERSION,
	BATCH_DIGEST_TERMINAL_EVENT_TYPES,
	BatchDigestRequestBodySchema,
	BatchDigestSseEventSchema,
	FailureEnvelopeSchema,
	type BatchDigestRequestBody,
	type BatchDigestSseEvent,
} from "@llm-wiki/workbench-contracts";

import { parseSSE } from "../sse";
import { ApiError } from "./client";
import {
	parseSseJson,
	RecoverableSseProtocolError,
	SseLifecycleGuard,
} from "./sse-contract";

export class BatchDigestProtocolError extends RecoverableSseProtocolError {
	constructor(message: string) {
		super(message);
		this.name = "BatchDigestProtocolError";
	}
}

export async function streamBatchDigest(
	input: BatchDigestRequestBody,
	signal?: AbortSignal,
): Promise<AsyncGenerator<BatchDigestSseEvent, void, undefined>> {
	const body = BatchDigestRequestBodySchema.parse(input);
	const response = await fetch("/api/knowledge-bases/batch-digest", {
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
			throw protocolError("启动请求失败，响应不符合统一错误契约");
		}
		const failure = FailureEnvelopeSchema.safeParse(payload);
		if (!failure.success) {
			throw protocolError("启动请求失败，响应不符合统一错误契约");
		}
		throw new ApiError(failure.data);
	}
	if (!response.body) throw protocolError("批量消化流缺少响应内容");
	return parseBatchDigestEvents(response.body);
}

export async function* parseBatchDigestEvents(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<BatchDigestSseEvent, void, undefined> {
	const guard = new SseLifecycleGuard({
		schemaVersion: BATCH_DIGEST_SSE_SCHEMA_VERSION,
		eventTypes: BATCH_DIGEST_SSE_EVENT_TYPES,
		identityFields: ["runId", "batchId"],
		terminalEventTypes: BATCH_DIGEST_TERMINAL_EVENT_TYPES,
		requireTerminal: true,
		eventName: "matches-type",
		error: protocolError,
	});

	for await (const message of parseSSE(stream)) {
		const value = parseSseJson(message.data, protocolError);
		guard.accept(value, message.event);
		const parsed = BatchDigestSseEventSchema.safeParse(value);
		if (!parsed.success) throw protocolError("事件缺少必要字段或不符合契约");
		yield parsed.data;
	}
	guard.finish();
}

function protocolError(message: string): BatchDigestProtocolError {
	return new BatchDigestProtocolError(message);
}
