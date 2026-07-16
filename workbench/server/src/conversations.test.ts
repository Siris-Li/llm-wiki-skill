import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { piMessagesToUIMessages } from "./conversations.js";

test("piMessagesToUIMessages renders history summaries for tool calls and results", () => {
	const messages = piMessagesToUIMessages([
		userMessage("请读取文件"),
		assistantMessage("我来读取。", [
			{
				type: "toolCall",
				id: "call-1",
				name: "read",
				arguments: { path: `${homedir()}/wiki/index.md` },
			},
		]),
		toolResultMessage("call-1", "read", "读取完成", false),
	]);

	assert.deepEqual(messages, [
		{ id: "u-0", role: "user", content: "请读取文件", tools: [] },
		{
			id: "a-1",
			role: "assistant",
			content: "我来读取。",
			tools: [{ name: "读取 ~/wiki/index.md：读取完成", status: "done" }],
		},
	]);
});

test("piMessagesToUIMessages uses best-effort summary for old incomplete tool calls", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("", [{ type: "tool_call", toolName: "bash" }]),
	]);

	assert.deepEqual(messages, [
		{
			id: "a-0",
			role: "assistant",
			content: "",
			tools: [{ name: "历史工具调用：bash", status: "done" }],
		},
	]);
});

test("piMessagesToUIMessages omits empty summaries for messages without tools", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("普通回答", []),
	]);

	assert.deepEqual(messages, [
		{ id: "a-0", role: "assistant", content: "普通回答", tools: [] },
	]);
});

test("piMessagesToUIMessages renders a safe failure for a saved model error", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("虚构的旧失败回复片段", [], {
			stopReason: "error",
			errorMessage: "fictional raw provider detail",
		}),
	]);

	assert.equal(messages[0]?.content, "生成回复时发生错误，请重试");
	assert.equal(JSON.stringify(messages).includes("fictional raw provider detail"), false);
	assert.equal(JSON.stringify(messages).includes("虚构的旧失败回复片段"), false);
});

test("piMessagesToUIMessages omits tool summaries attached to a saved terminal error", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("", [
			{
				type: "toolCall",
				id: "terminal-error-tool",
				name: "read",
				arguments: { path: "/fictional/private/case-231-notes.md" },
			},
		], {
			stopReason: "error",
			errorMessage: "fictional raw provider detail",
		}),
		toolResultMessage("terminal-error-tool", "read", "fictional private tool result", false),
	]);

	assert.equal(messages[0]?.content, "生成回复时发生错误，请重试");
	assert.deepEqual(messages[0]?.tools, []);
	assert.equal(JSON.stringify(messages).includes("/fictional/private/case-231-notes.md"), false);
	assert.equal(JSON.stringify(messages).includes("fictional private tool result"), false);
});

for (const [stopReason, terminalMessage] of [
	["error", "生成回复时发生错误，请重试"],
	["aborted", "生成已停止"],
] as const) {
	test(`piMessagesToUIMessages omits earlier tool summaries before a saved ${stopReason} terminal`, () => {
		const messages = piMessagesToUIMessages([
			userMessage("继续"),
			assistantMessage("我先检查。", [
				{
					type: "toolCall",
					id: `prior-${stopReason}-tool`,
					name: "read",
					arguments: { path: `/fictional/private/${stopReason}-terminal-input.md` },
				},
			]),
			toolResultMessage(
				`prior-${stopReason}-tool`,
				"read",
				"fictional private tool result",
				false,
			),
			assistantMessage("", [], {
				stopReason,
				errorMessage: "fictional raw terminal detail",
			}),
		]);

		assert.equal(messages[1]?.content.includes(terminalMessage), true);
		assert.deepEqual(messages[1]?.tools, []);
		assert.equal(
			JSON.stringify(messages).includes(`/fictional/private/${stopReason}-terminal-input.md`),
			false,
		);
		assert.equal(JSON.stringify(messages).includes("fictional private tool result"), false);
	});
}

test("piMessagesToUIMessages keeps a saved cancellation distinct from completion", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("取消前已显示的虚构回复片段", [], {
			stopReason: "aborted",
			errorMessage: "fictional raw abort detail",
		}),
	]);

	assert.equal(messages[0]?.content, "取消前已显示的虚构回复片段\n\n生成已停止");
	assert.equal(JSON.stringify(messages).includes("fictional raw abort detail"), false);
});

test("piMessagesToUIMessages hides a saved retry failure when the same turn later succeeds", () => {
	const messages = piMessagesToUIMessages([
		userMessage("模拟重试"),
		assistantMessage("", [], {
			stopReason: "error",
			errorMessage: "fictional retryable server error",
		}),
		assistantMessage("最终成功回复", []),
	]);

	assert.equal(messages[1]?.content, "最终成功回复");
	assert.equal(messages[1]?.content.includes("生成回复时发生错误"), false);
});

test("piMessagesToUIMessages does not invent details missing from tool results", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("执行命令。", [
			{ type: "toolCall", id: "call-2", name: "bash", arguments: {} },
		]),
		toolResultMessage("call-2", "bash", "", true),
	]);

	assert.deepEqual(messages[0]?.tools, [
		{ name: "历史工具调用：bash 失败", status: "done" },
	]);
});

test("piMessagesToUIMessages redacts private paths in historical tool results", () => {
	const messages = piMessagesToUIMessages([
		assistantMessage("读取文件。", [
			{
				type: "toolCall",
				id: "call-private",
				name: "read",
				arguments: { path: `${homedir()}/wiki/private.md` },
			},
		]),
		toolResultMessage("call-private", "read", `读取完成：${homedir()}/wiki/private.md`, false),
	]);

	assert.equal(JSON.stringify(messages).includes(homedir()), false);
	assert.deepEqual(messages[0]?.tools, [
		{ name: "读取 ~/wiki/private.md：读取完成：~/wiki/private.md", status: "done" },
	]);
});

test("piMessagesToUIMessages 把多步 assistant 轮合并成一个气泡", () => {
	const messages = piMessagesToUIMessages([
		userMessage("介绍一下"),
		assistantMessage("让我先看看。", [
			{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.md" } },
		]),
		toolResultMessage("t1", "read", "内容A", false),
		assistantMessage("", [
			{ type: "toolCall", id: "t2", name: "read", arguments: { path: "b.md" } },
		]),
		toolResultMessage("t2", "read", "内容B", false),
		assistantMessage("## 总览\n这是结论。", []),
	]);

	assert.equal(messages.length, 2);
	assert.equal(messages[0]?.role, "user");
	assert.equal(messages[1]?.role, "assistant");
	assert.equal(messages[1]?.tools.length, 2);
	assert.match(messages[1]?.content ?? "", /让我先看看/);
	assert.match(messages[1]?.content ?? "", /这是结论/);
});

test("piMessagesToUIMessages 不跨 user 边界合并（多轮保持独立）", () => {
	const messages = piMessagesToUIMessages([
		userMessage("Q1"),
		assistantMessage("A1", []),
		userMessage("Q2"),
		assistantMessage("A2", []),
	]);

	assert.deepEqual(
		messages.map((m) => m.role),
		["user", "assistant", "user", "assistant"],
	);
	assert.equal(messages[1]?.content, "A1");
	assert.equal(messages[3]?.content, "A2");
});

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
	} as AgentMessage;
}

function assistantMessage(
	text: string,
	extra: unknown[],
	terminal?: { stopReason: "error" | "aborted"; errorMessage: string },
): AgentMessage {
	return {
		role: "assistant",
		content: [
			...(text ? [{ type: "text", text }] : []),
			...extra,
		],
		...terminal,
	} as AgentMessage;
}

function toolResultMessage(
	toolCallId: string,
	toolName: string,
	text: string,
	isError: boolean,
): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: text ? [{ type: "text", text }] : [],
		isError,
	} as AgentMessage;
}
