/**
 * llm-wiki-agent 后端入口
 *
 * 阶段一 step 2：最小 Hono 服务器，验证全链路通。
 * 仅提供 /api/health（心跳）和 /api/echo（原样回显）。
 * agent 接入在 step 4。
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const app = new Hono();

// 心跳：用于前端 / 用户确认后端已起
app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: Date.now(),
		service: "llm-wiki-agent/server",
	});
});

// 回显：用于验证 POST + JSON 解析链路
app.post("/api/echo", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	return c.json({ ok: true, received: body });
});

// 流式回显（SSE）：为后续 agent 事件流排练
// 每 50ms 推一个字符（按 Unicode codepoint），完成后推 done 事件
app.get("/api/stream-echo", (c) => {
	const text = c.req.query("text") ?? "Hello, world!";
	return streamSSE(c, async (stream) => {
		// 用扩展运算符按 Unicode codepoint 切分，避免把中文 / emoji 切坏
		const chars = [...text];
		for (const char of chars) {
			await stream.writeSSE({
				event: "token",
				data: char,
			});
			await stream.sleep(50);
		}
		await stream.writeSSE({
			event: "done",
			data: JSON.stringify({ total: chars.length }),
		});
	});
});

const PORT = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`[llm-wiki-agent/server] listening on http://localhost:${info.port}`);
	console.log(`  GET  /api/health`);
	console.log(`  POST /api/echo`);
	console.log(`  GET  /api/stream-echo?text=...`);
});
