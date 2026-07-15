import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
	MODEL_CANCELLED_MESSAGE,
	MODEL_FAILURE_MESSAGE,
	PublishedAssistantText,
	finalizeSessionTerminalMessages,
	protectSessionTerminalMessages,
	sanitizePersistedSessionTerminalMessages,
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

test("取消写入会话前只保留已经展示的文字，并移除原始失败内容", () => {
	const message = assistantMessage("aborted", "fictional abort detail", [
		{
			type: "abort_failure",
			timestamp: 0,
			error: { message: "fictional abort detail", stack: "fictional abort detail" },
		},
	]);
	message.content = [{ type: "text", text: "最终消息中未展示的虚构回复片段" }];
	const sanitized = sanitizeAssistantTerminalMessage(message, "取消前已显示的虚构回复片段");

	assert.notEqual(sanitized, message);
	assert.equal(sanitized.stopReason, "aborted");
	assert.equal(sanitized.errorMessage, MODEL_CANCELLED_MESSAGE);
	assert.deepEqual(sanitized.content, [{ type: "text", text: "取消前已显示的虚构回复片段" }]);
	assert.equal(JSON.stringify(sanitized).includes("fictional abort detail"), false);
	assert.equal(JSON.stringify(sanitized).includes("最终消息中未展示"), false);
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

	const sanitized = sanitizeAssistantTerminalMessage(message, "取消前已显示的虚构回复片段");

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

test("模型恢复判断完成前保留原消息，最终结束后同步清除内存和记录", async (t) => {
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
	assert.equal(message.errorMessage, "fictional retryable server error");
	assert.equal(message.diagnostics?.[0]?.error?.stack, "fictional diagnostic stack");
	finalizeSessionTerminalMessages(sessionManager, "error");

	assert.equal(message.errorMessage, MODEL_FAILURE_MESSAGE);
	assert.deepEqual(message.content, []);
	assert.equal("diagnostics" in message, false);
	assert.equal(JSON.stringify(message).includes("fictional retryable server error"), false);
	assert.equal(JSON.stringify(message).includes("fictional diagnostic stack"), false);
	assert.equal(JSON.stringify(message).includes("fictional partial response"), false);
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

test("正常取消只保存实际流式展示的回复片段，同时移除取消诊断", () => {
	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));
	const message = assistantMessage("aborted", "fictional abort detail", [
		{
			type: "abort_failure",
			timestamp: 0,
			error: { message: "fictional abort detail", stack: "fictional abort detail" },
		},
	]);
	message.content = [{ type: "text", text: "最终消息中未展示的虚构回复片段" }];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(
		sessionManager,
		"aborted",
		"取消前已显示的虚构回复片段",
	);

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.match(serialized, /"stopReason":"aborted"/);
	assert.equal(serialized.includes("取消前已显示的虚构回复片段"), true);
	assert.equal(serialized.includes("最终消息中未展示的虚构回复片段"), false);
	assert.equal(serialized.includes("fictional abort detail"), false);
});

test("取消最终消息没有流式文字时，不保存模型直接附带的未展示内容", () => {
	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));
	const message = assistantMessage("aborted");
	message.content = [{ type: "text", text: "模型直接附带但前台从未展示的虚构文字" }];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(sessionManager, "aborted", "");

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.match(serialized, /"stopReason":"aborted"/);
	assert.equal(serialized.includes("模型直接附带但前台从未展示的虚构文字"), false);
});

test("取消只保留最终助手消息已经展示的文字，不混入工具调用前的回复", () => {
	const displayedText = new PublishedAssistantText();
	displayedText.append("工具调用前已展示的虚构文字");
	displayedText.endAssistantMessage("toolUse");
	displayedText.append("最终取消前已展示的虚构文字");
	displayedText.endAssistantMessage("aborted");

	const sessionManager = protectSessionTerminalMessages(SessionManager.inMemory("/fictional/project"));
	const message = assistantMessage("aborted");
	message.content = [{ type: "text", text: "最终消息中混入的虚构文字" }];

	sessionManager.appendMessage(message);
	finalizeSessionTerminalMessages(sessionManager, "aborted", displayedText.terminalText);

	const serialized = JSON.stringify(sessionManager.getEntries());
	assert.equal(serialized.includes("最终取消前已展示的虚构文字"), true);
	assert.equal(serialized.includes("工具调用前已展示的虚构文字"), false);
	assert.equal(serialized.includes("最终消息中混入的虚构文字"), false);
});

test("旧错误会话在恢复前会被安全重写，不进入下一次模型上下文", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "llm-wiki-terminal-legacy-test-"));
	t.after(async () => {
		await rm(directory, { recursive: true, force: true });
	});
	const sessionFile = join(directory, "legacy.jsonl");
	const unsafeMessage = assistantMessage("error", "fictional legacy provider secret", [
		{
			type: "provider_failure",
			timestamp: 0,
			error: {
				message: "fictional legacy diagnostic",
				stack: "fictional legacy stack /fictional/private/legacy-stack",
			},
		},
	]);
	unsafeMessage.content = [
		{ type: "text", text: "fictional legacy partial text" },
		{
			type: "toolCall",
			id: "fictional-legacy-tool",
			name: "read",
			arguments: { path: "/fictional/private/legacy-tool-argument" },
		},
	];
	const entries = [
		{
			type: "session",
			version: 3,
			id: "legacy-session",
			timestamp: new Date(0).toISOString(),
			cwd: "/fictional/project",
		},
		{
			type: "message",
			id: "legacy-user",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			message: { role: "user", content: "继续", timestamp: 0 },
		},
		{
			type: "message",
			id: "legacy-error",
			parentId: "legacy-user",
			timestamp: new Date(0).toISOString(),
			message: unsafeMessage,
		},
	];
	await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

	assert.equal(await sanitizePersistedSessionTerminalMessages(sessionFile), true);

	const persisted = await readFile(sessionFile, "utf8");
	const restoredContext = SessionManager.open(sessionFile).buildSessionContext();
	const serializedContext = JSON.stringify(restoredContext.messages);
	assert.match(persisted, /"stopReason":"error"/);
	assert.match(persisted, new RegExp(MODEL_FAILURE_MESSAGE));
	assert.equal(persisted.includes("fictional legacy provider secret"), false);
	assert.equal(persisted.includes("fictional legacy diagnostic"), false);
	assert.equal(persisted.includes("fictional legacy stack"), false);
	assert.equal(persisted.includes("fictional legacy partial text"), false);
	assert.equal(persisted.includes("fictional-legacy-tool"), false);
	assert.equal(persisted.includes("/fictional/private/legacy-tool-argument"), false);
	assert.equal(serializedContext.includes("fictional legacy provider secret"), false);
	assert.equal(serializedContext.includes("fictional legacy diagnostic"), false);
	assert.equal(serializedContext.includes("fictional legacy stack"), false);
	assert.equal(serializedContext.includes("fictional legacy partial text"), false);
	assert.equal(serializedContext.includes("fictional-legacy-tool"), false);
	assert.equal(serializedContext.includes("/fictional/private/legacy-tool-argument"), false);
	assert.equal(serializedContext.includes(MODEL_FAILURE_MESSAGE), true);
});

test("已安全保存的取消片段在恢复时保持可见", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "llm-wiki-terminal-safe-abort-test-"));
	t.after(async () => {
		await rm(directory, { recursive: true, force: true });
	});
	const sessionFile = join(directory, "safe-abort.jsonl");
	const safeMessage = assistantMessage("aborted", MODEL_CANCELLED_MESSAGE);
	safeMessage.content = [{ type: "text", text: "已展示的虚构取消片段" }];
	const entries = [
		{
			type: "session",
			version: 3,
			id: "safe-abort-session",
			timestamp: new Date(0).toISOString(),
			cwd: "/fictional/project",
		},
		{
			type: "message",
			id: "safe-abort-message",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			message: safeMessage,
		},
	];
	await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

	assert.equal(await sanitizePersistedSessionTerminalMessages(sessionFile), false);

	const persisted = await readFile(sessionFile, "utf8");
	const restoredContext = SessionManager.open(sessionFile).buildSessionContext();
	assert.equal(persisted.includes("已展示的虚构取消片段"), true);
	assert.equal(JSON.stringify(restoredContext.messages).includes("已展示的虚构取消片段"), true);
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
	finalizeSessionTerminalMessages(sessionManager, "aborted", "取消前已显示的虚构回复片段");

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
