import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
	MODEL_CANCELLED_MESSAGE,
	MODEL_FAILURE_MESSAGE,
	finalizeSessionTerminalMessages,
	protectSessionTerminalMessages,
	sanitizeAssistantTerminalMessage,
} from "./prompt-terminal.js";

test("模型错误写入会话前保留失败事实，但移除原始失败内容", () => {
	const message = assistantMessage("error", "fictional provider secret detail", [
		{
			type: "provider_failure",
			timestamp: 0,
			error: {
				message: "fictional provider secret detail",
				stack: "fictional provider secret detail",
			},
			details: { path: "fictional provider secret detail" },
		},
	]);
	message.content = [{ type: "text", text: "fictional partial response from /fictional/private" }];
	const sanitized = sanitizeAssistantTerminalMessage(message);

	assert.notEqual(sanitized, message);
	assert.equal(sanitized.stopReason, "error");
	assert.equal(sanitized.errorMessage, MODEL_FAILURE_MESSAGE);
	assert.equal(JSON.stringify(sanitized).includes("fictional provider secret detail"), false);
	assert.equal(JSON.stringify(sanitized).includes("fictional partial response"), false);
	assert.deepEqual(sanitized.content, []);
	assert.equal("diagnostics" in sanitized, false);
});

test("取消写入会话前保留取消事实，但移除原始失败内容", () => {
	const message = assistantMessage("aborted", "fictional abort detail", [
		{
			type: "abort_failure",
			timestamp: 0,
			error: { message: "fictional abort detail", stack: "fictional abort detail" },
		},
	]);
	message.content = [{ type: "text", text: "取消前已显示的虚构回复片段" }];
	const sanitized = sanitizeAssistantTerminalMessage(message);

	assert.notEqual(sanitized, message);
	assert.equal(sanitized.stopReason, "aborted");
	assert.equal(sanitized.errorMessage, MODEL_CANCELLED_MESSAGE);
	assert.deepEqual(sanitized.content, message.content);
	assert.equal(JSON.stringify(sanitized).includes("fictional abort detail"), false);
	assert.equal("diagnostics" in sanitized, false);
});

test("取消写入会话前只保留已显示的文本，不保存推理或工具参数", () => {
	const message = assistantMessage("aborted");
	message.content = [
		{ type: "thinking", thinking: "fictional hidden reasoning", thinkingSignature: "fictional hidden signature" },
		{
			type: "toolCall",
			id: "fictional-hidden-tool",
			name: "read",
			arguments: { path: "/fictional/private/tool-argument" },
		},
		{ type: "text", text: "取消前已显示的虚构回复片段", textSignature: "fictional hidden text signature" },
	];

	const sanitized = sanitizeAssistantTerminalMessage(message);

	assert.deepEqual(sanitized.content, [{ type: "text", text: "取消前已显示的虚构回复片段" }]);
	const serialized = JSON.stringify(sanitized);
	assert.equal(serialized.includes("fictional hidden reasoning"), false);
	assert.equal(serialized.includes("fictional hidden signature"), false);
	assert.equal(serialized.includes("fictional-hidden-tool"), false);
	assert.equal(serialized.includes("/fictional/private/tool-argument"), false);
	assert.equal(serialized.includes("fictional hidden text signature"), false);
});

test("正常助手结束不改写", () => {
	const message = assistantMessage("stop");
	assert.equal(sanitizeAssistantTerminalMessage(message), message);
});

test("会话写入只保存安全副本，保留原消息供模型重试判断", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "llm-wiki-terminal-test-"));
	t.after(async () => {
		await rm(directory, { recursive: true, force: true });
	});
	const sessionManager = protectSessionTerminalMessages(
		SessionManager.create("/fictional/project", directory),
	);
	const message = assistantMessage("error", "fictional retryable server error", [
		{
			type: "provider_failure",
			timestamp: 0,
			error: {
				message: "fictional diagnostic detail",
				stack: "fictional diagnostic stack",
			},
		},
	]);
	message.content = [{ type: "text", text: "fictional partial response from /fictional/private" }];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(sessionManager, "error");

	assert.equal(message.errorMessage, "fictional retryable server error");
	assert.equal(message.diagnostics?.[0]?.error?.stack, "fictional diagnostic stack");
	const sessionFile = sessionManager.getSessionFile();
	assert.ok(sessionFile);
	const persisted = await readFile(sessionFile, "utf8");
	assert.match(persisted, /"stopReason":"error"/);
	assert.match(persisted, new RegExp(MODEL_FAILURE_MESSAGE));
	assert.equal(persisted.includes("fictional retryable server error"), false);
	assert.equal(persisted.includes("fictional diagnostic detail"), false);
	assert.equal(persisted.includes("fictional diagnostic stack"), false);
	assert.equal(persisted.includes("fictional partial response"), false);
});

test("恢复成功会丢弃暂存失败，不把失败混进默认会话", () => {
	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));

	sessionManager.appendMessage(assistantMessage("error", "fictional retryable server error"));
	sessionManager.appendMessage({
		...assistantMessage("stop"),
		content: [{ type: "text", text: "恢复后的正常回复" }],
	});
	finalizeSessionTerminalMessages(sessionManager, null);

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.equal(serialized.includes("fictional retryable server error"), false);
	assert.equal(serialized.includes(MODEL_FAILURE_MESSAGE), false);
	assert.equal(serialized.includes("恢复后的正常回复"), true);
});

test("重试间隙取消会把暂存失败保存为安全取消", () => {
	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));
	const message = assistantMessage("error", "fictional retryable server error");
	message.content = [{ type: "text", text: "错误尝试中的虚构片段" }];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(sessionManager, "aborted");

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.match(serialized, /"stopReason":"aborted"/);
	assert.equal(serialized.includes(MODEL_CANCELLED_MESSAGE), true);
	assert.equal(serialized.includes("fictional retryable server error"), false);
	assert.equal(serialized.includes("错误尝试中的虚构片段"), false);
});

test("正常取消会保存已显示的回复片段，同时移除取消诊断", () => {
	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));
	const message = assistantMessage("aborted", "fictional abort detail", [
		{
			type: "abort_failure",
			timestamp: 0,
			error: { message: "fictional abort detail", stack: "fictional abort detail" },
		},
	]);
	message.content = [{ type: "text", text: "取消前已显示的虚构回复片段" }];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(sessionManager, "aborted");

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.match(serialized, /"stopReason":"aborted"/);
	assert.equal(serialized.includes("取消前已显示的虚构回复片段"), true);
	assert.equal(serialized.includes("fictional abort detail"), false);
});

test("正常取消写入会话时不会保存未展示的推理或工具参数", () => {
	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));
	const message = assistantMessage("aborted");
	message.content = [
		{ type: "thinking", thinking: "fictional hidden reasoning" },
		{
			type: "toolCall",
			id: "fictional-hidden-tool",
			name: "read",
			arguments: { path: "/fictional/private/tool-argument" },
		},
		{ type: "text", text: "取消前已显示的虚构回复片段" },
	];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(sessionManager, "aborted");

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.equal(serialized.includes("取消前已显示的虚构回复片段"), true);
	assert.equal(serialized.includes("fictional hidden reasoning"), false);
	assert.equal(serialized.includes("fictional-hidden-tool"), false);
	assert.equal(serialized.includes("/fictional/private/tool-argument"), false);
});

function assistantMessage(
	stopReason: AssistantMessage["stopReason"],
	errorMessage?: string,
	diagnostics?: AssistantMessage["diagnostics"],
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
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
		stopReason,
		...(errorMessage ? { errorMessage } : {}),
		...(diagnostics ? { diagnostics } : {}),
		timestamp: 0,
	};
}
