import assert from "node:assert/strict";
import test from "node:test";

import { parseSSE } from "../src/lib/sse";

test("parseSSE supports CRLF-delimited frames", async () => {
	const messages = await collect(
		parseSSE(streamFromChunks(["event: ready\r\ndata: {\"ok\":true}\r\n\r\n"])),
	);
	assert.deepEqual(messages, [{ event: "ready", data: '{"ok":true}' }]);
});

test("parseSSE flushes a UTF-8 character split across chunks", async () => {
	const bytes = new TextEncoder().encode("event: message\ndata: 你好\n\n");
	const split = bytes.findIndex((byte, index) => index > 20 && byte >= 0x80);
	const messages = await collect(
		parseSSE(streamFromBytes([bytes.slice(0, split + 1), bytes.slice(split + 1)])),
	);
	assert.deepEqual(messages, [{ event: "message", data: "你好" }]);
});

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return streamFromBytes(chunks.map((chunk) => encoder.encode(chunk)));
}

function streamFromBytes(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

async function collect<T>(stream: AsyncGenerator<T, void, undefined>): Promise<T[]> {
	const messages: T[] = [];
	for await (const message of stream) messages.push(message);
	return messages;
}
