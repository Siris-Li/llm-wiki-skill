import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { finalizeTerminalSessionState } from "./agent.js";
import { piMessagesToUIMessages } from "./conversations.js";
import {
	MODEL_FAILURE_MESSAGE,
	protectSessionTerminalMessages,
} from "./extensions/prompt-terminal.js";

test("阈值压缩后最终失败仍同步到活动会话", () => {
	const sessionManager = protectSessionTerminalMessages(
		SessionManager.inMemory("/fictional/project"),
	);
	const userMessageId = sessionManager.appendMessage({
		role: "user",
		content: "触发阈值压缩的虚构请求",
		timestamp: 0,
	});
	const terminalMessage = {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "fictional raw failure from /fictional/private" }],
		api: "fictional-api",
		provider: "fictional-provider",
		model: "fictional-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error" as const,
		errorMessage: "fictional raw failure from /fictional/private",
		timestamp: 0,
	};
	sessionManager.appendMessage(terminalMessage);

	// The SDK rebuilds its live state from the persisted context after compaction.
	sessionManager.appendCompaction("先前上下文的安全摘要", userMessageId, 1);
	const session = {
		state: { messages: sessionManager.buildSessionContext().messages },
	} as unknown as AgentSession;
	assert.equal(
		JSON.stringify(piMessagesToUIMessages(session.state.messages)).includes(MODEL_FAILURE_MESSAGE),
		false,
	);

	assert.equal(finalizeTerminalSessionState(session, sessionManager, "error"), true);

	const uiMessages = piMessagesToUIMessages(session.state.messages);
	const serialized = JSON.stringify(uiMessages);
	assert.equal(serialized.includes(MODEL_FAILURE_MESSAGE), true);
	assert.equal(serialized.includes("fictional raw failure from /fictional/private"), false);
});
