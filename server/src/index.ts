/**
 * llm-wiki-agent 后端入口
 *
 * 阶段一 step 2：最小 Hono 服务器，验证全链路通。
 * 仅提供 /api/health（心跳）和 /api/echo（原样回显）。
 * agent 接入在 step 4。
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";

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

const PORT = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`[llm-wiki-agent/server] listening on http://localhost:${info.port}`);
	console.log(`  GET  /api/health`);
	console.log(`  POST /api/echo`);
});
