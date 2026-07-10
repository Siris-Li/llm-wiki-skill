import assert from "node:assert/strict";
import test from "node:test";

import { failure } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import { HttpContractError } from "./http/request.js";

type EnvelopeJson = {
	ok?: boolean;
	code?: string;
	message?: string;
	details?: { diagnosticId?: string; field?: string } | null;
	data?: { status?: string; service?: string; timestamp?: number };
};

test("GET /api/health 返回统一成功 envelope", async () => {
	const app = createApp({ mode: "test" });
	const res = await app.request("/api/health");
	assert.equal(res.status, 200);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, true);
	assert.equal(json.data?.status, "ok");
	assert.equal(json.data?.service, "llm-wiki-agent/server");
	assert.equal(typeof json.data?.timestamp, "number");
	assert.ok((json.data?.timestamp ?? -1) >= 0);
});

test("createApp().request 可直接调用，不启动端口、不 bootstrap、不读写真实用户目录", async () => {
	// 不传任何真实依赖；health 不触碰文件系统。证明 route 测试无需真实端口。
	const app = createApp();
	const res = await app.request("/api/health");
	assert.equal(res.status, 200);
});

test("route 抛 HttpContractError 时映射为对应失败 envelope 和状态码", async () => {
	const app = createApp();
	app.get("/api/contract-bad", () => {
		throw new HttpContractError("MISSING_FIELD", "缺少 path", {
			field: "path",
		});
	});
	const res = await app.request("/api/contract-bad");
	assert.equal(res.status, 400); // MISSING_FIELD -> 400
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "MISSING_FIELD");
	assert.equal(json.message, "缺少 path");
	assert.equal(json.details?.field, "path");
});

test("未捕获错误兜底为 INTERNAL_ERROR，绝不泄露 message/stack/路径/key", async () => {
	const app = createApp({ mode: "test" });
	app.get("/api/throw", () => {
		throw new Error("/Users/secret/path boom api_key=sk-leak");
	});
	const res = await app.request("/api/throw");
	assert.equal(res.status, 500);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INTERNAL_ERROR");
	assert.equal(json.message, "服务器内部错误");
	const body = JSON.stringify(json);
	assert.equal(body.includes("secret"), false);
	assert.equal(body.includes("api_key"), false);
	assert.equal(body.includes("leak"), false);
	assert.equal(body.includes("Users"), false);
	assert.equal(body.includes("stack"), false);
	// test 模式带脱敏 diagnosticId，且它本身不含敏感信息
	assert.equal(typeof json.details?.diagnosticId, "string");
	assert.ok((json.details?.diagnosticId ?? "").length > 0);
});

test("dev 模式 INTERNAL_ERROR 默认不带 details", async () => {
	const app = createApp({ mode: "dev" });
	app.get("/api/throw", () => {
		throw new Error("boom");
	});
	const res = await app.request("/api/throw");
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.details, undefined);
});

test("注入 deps.security 后作用于 /api/* 请求（#166 接入点预留）", async () => {
	let called = 0;
	const app = createApp({
		security: async (_c, next) => {
			called += 1;
			await next();
		},
	});
	const res = await app.request("/api/health");
	assert.equal(res.status, 200);
	assert.equal(called, 1);
});

test("deps.security 直接返回响应时短路（模拟 #166 对会改状态端点的拒绝）", async () => {
	const app = createApp({
		security: async (c) =>
			c.json(failure("FORBIDDEN_LOCAL_API", "缺少 capability token"), 403),
	});
	// 临时挂一个会改状态的端点，模拟 #166 之后的迁移路由
	app.post("/api/sensitive", (c) => c.json({ ok: true }));
	const res = await app.request("/api/sensitive", { method: "POST" });
	assert.equal(res.status, 403);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.code, "FORBIDDEN_LOCAL_API");
});
