import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";

import { ChatPanel } from "../src/components/ChatPanel";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { changeText, pressKey, render, screen, waitFor } from "./render";

const originalFetch = globalThis.fetch;
const MODEL_FAILURE_MESSAGE = "生成回复时发生错误，请重试";
const RAW_PROVIDER_DETAIL = "fictional provider detail that must stay private";

type StreamEvent = { event: string; data: string };

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("ChatPanel model failure", () => {
	it("shows a safe failure, keeps the composer usable, and recovers on the next send", async () => {
		installChatFetch([
			[promptEvent("assistant_error", 1, {
				code: "INTERNAL_ERROR",
				message: MODEL_FAILURE_MESSAGE,
			})],
			[
				promptEvent("assistant_text_delta", 1, { delta: "恢复后的虚构回复" }),
				promptEvent("assistant_done", 2),
			],
		]);
		renderChatPanel();

		const composer = screen.getByPlaceholderText(/写下想法/);
		await changeText(composer, "触发受控失败");
		await pressKey(composer, "Enter", { metaKey: true });

		assert.ok(await screen.findByText(MODEL_FAILURE_MESSAGE, { exact: true }));
		assert.equal(screen.getByRole("alert").textContent, "出错");
		assert.equal(composer.disabled, false);
		assert.equal(document.body.textContent?.includes(RAW_PROVIDER_DETAIL), false);

		await changeText(composer, "失败后继续操作");
		await pressKey(composer, "Enter", { metaKey: true });

		await waitFor(() => {
			assert.ok(screen.getByText("恢复后的虚构回复", { exact: true }));
			assert.equal(screen.queryByText(MODEL_FAILURE_MESSAGE, { exact: true }), null);
			assert.equal(screen.queryByRole("alert"), null);
			assert.equal(composer.disabled, false);
		});
	});
});

function renderChatPanel() {
	return render(
		<TooltipProvider>
			<ChatPanel
				currentKnowledgeBaseName="示例知识库"
				currentKnowledgeBasePath="/fictional-kb"
				initialMessages={[]}
			/>
		</TooltipProvider>,
	);
}

function installChatFetch(responses: StreamEvent[][]) {
	let promptCall = 0;
	globalThis.fetch = (async (input) => {
		const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
		if (url.includes("/api/commands")) return jsonResponse({ ok: true, data: [] });
		if (url.includes("/api/prompt")) {
			const events = responses[promptCall++];
			assert.ok(events, "unexpected prompt request");
			return new Response(sseStream(events), {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		}
		return jsonResponse({ ok: true });
	}) as typeof fetch;
}

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function promptEvent(type: string, seq: number, extra: Record<string, unknown> = {}): StreamEvent {
	return {
		event: type,
		data: JSON.stringify({ schemaVersion: 1, type, runId: "run-fixture", messageId: "message-fixture", seq, ...extra }),
	};
}

function sseStream(events: StreamEvent[]) {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const item of events) {
				controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${item.data}\n\n`));
			}
			controller.close();
		},
	});
}
