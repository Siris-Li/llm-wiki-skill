import assert from "node:assert/strict";
import test from "node:test";

import { failure } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import { HttpContractError } from "./http/request.js";

type EnvelopeJson = {
	ok?: boolean;
	code?: string;
	message?: string;
	details?: { diagnosticId?: string; field?: string; issues?: Array<{ path: string; message: string }> } | null;
	data?: any;
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

test("GET /api/config 返回统一成功 envelope，且 route seam 不读写真实用户目录", async () => {
	const app = createApp({
		configService: {
			loadConfig: async () => ({
				version: 1,
				externalKnowledgeBases: [],
				showUserGlobalSkills: true,
				modelRoles: { main: { provider: "anthropic", modelId: "claude-sonnet" } },
			}),
			saveConfig: async () => {
				throw new Error("GET 不应写配置");
			},
			listAvailableModels: () => [],
			reloadActiveResources: async () => {
				throw new Error("GET 不应 reload");
			},
		},
	});
	const res = await app.request("/api/config");
	assert.equal(res.status, 200);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, true);
	assert.equal((json.data as { version?: number })?.version, 1);
	assert.equal((json.data as { showUserGlobalSkills?: boolean })?.showUserGlobalSkills, true);
});

test("POST /api/config 校验 JSON body，写入后返回统一成功 envelope", async () => {
	let saved: unknown;
	let reloaded = 0;
	const app = createApp({
		configService: {
			loadConfig: async () => ({ version: 1, externalKnowledgeBases: [] }),
			saveConfig: async (next) => {
				saved = next;
			},
			listAvailableModels: () => [],
			reloadActiveResources: async () => {
				reloaded += 1;
			},
		},
	});
	const res = await app.request("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ showUserGlobalSkills: true, modelRoles: { main: null } }),
	});
	assert.equal(res.status, 200);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, true);
	assert.deepEqual(saved, {
		version: 1,
		externalKnowledgeBases: [],
		showUserGlobalSkills: true,
		modelRoles: { main: null },
	});
	assert.equal(reloaded, 1);
	assert.equal((json.data as { showUserGlobalSkills?: boolean })?.showUserGlobalSkills, true);
});

test("POST /api/config 对模型引用 trim 后保存，并拒绝空模型字段", async () => {
	let saved: unknown;
	const app = createApp({
		configService: {
			loadConfig: async () => ({ version: 1, externalKnowledgeBases: [] }),
			saveConfig: async (next) => {
				saved = next;
			},
			listAvailableModels: () => [],
			reloadActiveResources: async () => {},
		},
	});
	const ok = await app.request("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			modelRoles: { main: { provider: " anthropic ", modelId: " claude-sonnet " } },
		}),
	});
	assert.equal(ok.status, 200);
	assert.deepEqual(saved, {
		version: 1,
		externalKnowledgeBases: [],
		modelRoles: { main: { provider: "anthropic", modelId: "claude-sonnet" } },
	});

	const invalid = await app.request("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ modelRoles: { main: { provider: " ", modelId: "claude-sonnet" } } }),
	});
	assert.equal(invalid.status, 400);
	const json = (await invalid.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INVALID_REQUEST");
});

test("POST /api/config invalid JSON 返回 INVALID_JSON envelope", async () => {
	const app = createApp();
	const res = await app.request("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{bad",
	});
	assert.equal(res.status, 400);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INVALID_JSON");
	assert.equal(json.message, "请求体不是有效的 JSON");
});

test("POST /api/config invalid request 返回 typed details 且不包含原始 body", async () => {
	const app = createApp();
	const res = await app.request("/api/config", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ showUserGlobalSkills: "yes", secret: "sk-should-not-echo" }),
	});
	assert.equal(res.status, 400);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INVALID_REQUEST");
	assert.equal(Array.isArray(json.details?.issues), true);
	assert.equal(JSON.stringify(json).includes("sk-should-not-echo"), false);
});

test("GET /api/models 返回统一成功 envelope", async () => {
	const app = createApp({
		configService: {
			loadConfig: async () => ({ version: 1, externalKnowledgeBases: [] }),
			saveConfig: async () => {},
			listAvailableModels: () => [
				{
					provider: "anthropic",
					modelId: "claude-sonnet",
					name: "Claude Sonnet",
					reasoning: false,
					contextWindow: 200000,
					cost: { input: 3, output: 15 },
					hasAuth: true,
				},
			],
			reloadActiveResources: async () => {},
		},
	});
	const res = await app.request("/api/models");
	assert.equal(res.status, 200);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, true);
	assert.equal(Array.isArray(json.data), true);
	assert.equal((json.data as Array<{ provider?: string }>)[0]?.provider, "anthropic");
});

test("GET /api/auth/status 返回脱敏认证状态，不泄露 key、auth 路径、环境变量值或 raw provider error", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({
				authFileExists: true,
				providers: [{ id: "anthropic", type: "api_key", configured: true }],
				envKeys: [{ name: "ANTHROPIC_API_KEY", present: true }],
			}),
			setAuthKey: async () => {},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
	});
	const res = await app.request("/api/auth/status");
	assert.equal(res.status, 200);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, true);
	const body = JSON.stringify(json);
	assert.equal(body.includes("sk-"), false);
	assert.equal(body.includes("/Users/"), false);
	assert.equal(body.includes(".pi/agent/auth.json"), false);
	assert.equal(body.includes(String(process.env.ANTHROPIC_API_KEY ?? "__absent__")), false);
});

test("GET /api/auth/status 服务异常返回统一失败 envelope，且不泄露敏感细节", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => {
				throw new Error("/Users/demo/.pi/agent/auth.json raw provider error api_key=sk-should-not-leak");
			},
			setAuthKey: async () => {},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
		mode: "test",
	});
	const res = await app.request("/api/auth/status");
	assert.equal(res.status, 500);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INTERNAL_ERROR");
	assert.equal(json.message, "服务器内部错误");
	const body = JSON.stringify(json);
	assert.equal(body.includes("/Users/"), false);
	assert.equal(body.includes(".pi/agent/auth.json"), false);
	assert.equal(body.includes("raw provider error"), false);
	assert.equal(body.includes("sk-should-not-leak"), false);
});

test("POST /api/auth/set 经统一 route 写入认证并返回成功 envelope", async () => {
	let saved: { provider: string; key: string } | undefined;
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async (provider: string, key: string) => {
				saved = { provider, key };
			},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
	});
	const res = await app.request("/api/auth/set", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic", type: "api_key", key: "sk-route-test" }),
	});

	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true, data: { saved: true } });
	assert.deepEqual(saved, { provider: "anthropic", key: "sk-route-test" });
});

test("POST /api/auth/test 经统一 route 返回连接成功消息", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
	});
	const res = await app.request("/api/auth/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic" }),
	});

	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), {
		ok: true,
		data: { message: "连接成功，模型可用" },
	});
});

test("POST /api/auth/test 将认证失败收敛为脱敏的稳定错误", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {},
			testAuthConnection: async () => ({
				ok: false,
				error: "401 invalid key sk-auth-should-not-leak at /Users/private/.pi/agent/auth.json",
			}),
		},
		mode: "test",
	});
	const res = await app.request("/api/auth/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic" }),
	});

	assert.equal(res.status, 400);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "AUTHENTICATION_FAILED");
	assert.equal(json.message, "认证连接失败，请检查 API key 后重试");
	const body = JSON.stringify(json);
	assert.equal(body.includes("sk-auth-should-not-leak"), false);
	assert.equal(body.includes("/Users/private"), false);
	assert.equal(body.includes("invalid key"), false);
});

test("POST /api/auth/test 将不支持的平台映射为统一错误", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {},
			testAuthConnection: async () => {
				throw Object.assign(new Error("native details should not leak"), {
					code: "ENOTSUP",
				});
			},
		},
	});
	const res = await app.request("/api/auth/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic" }),
	});

	assert.equal(res.status, 501);
	assert.deepEqual(await res.json(), {
		ok: false,
		code: "UNSUPPORTED_PLATFORM",
		message: "当前平台不支持认证连接测试",
	});
});

test("认证写入和连接测试拒绝坏请求，且不回显 API key", async () => {
	const app = createApp();
	const invalidJson = await app.request("/api/auth/set", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{bad",
	});
	assert.equal(invalidJson.status, 400);
	assert.deepEqual(await invalidJson.json(), {
		ok: false,
		code: "INVALID_JSON",
		message: "请求体不是有效的 JSON",
	});

	const invalidRequest = await app.request("/api/auth/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: " ", key: "sk-auth-should-not-echo" }),
	});
	assert.equal(invalidRequest.status, 400);
	const invalidJsonBody = (await invalidRequest.json()) as EnvelopeJson;
	assert.equal(invalidJsonBody.ok, false);
	assert.equal(invalidJsonBody.code, "INVALID_REQUEST");
	assert.equal(JSON.stringify(invalidJsonBody).includes("sk-auth-should-not-echo"), false);
});

test("认证写入的内部失败使用统一错误且不泄露本机信息", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {
				throw new Error("/Users/private/.pi/agent/auth.json sk-auth-should-not-leak");
			},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
		mode: "test",
	});
	const res = await app.request("/api/auth/set", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic", type: "api_key", key: "sk-auth-should-not-leak" }),
	});

	assert.equal(res.status, 500);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INTERNAL_ERROR");
	assert.equal(json.message, "服务器内部错误");
	const body = JSON.stringify(json);
	assert.equal(body.includes("/Users/private"), false);
	assert.equal(body.includes("sk-auth-should-not-leak"), false);
});

test("认证写入的平台失败仍使用通用安全错误", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {
				throw Object.assign(new Error("filesystem details should not leak"), {
					code: "ENOTSUP",
				});
			},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
	});
	const res = await app.request("/api/auth/set", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic", type: "api_key", key: "sk-auth-should-not-leak" }),
	});

	assert.equal(res.status, 500);
	assert.deepEqual(await res.json(), {
		ok: false,
		code: "INTERNAL_ERROR",
		message: "服务器内部错误",
	});
});

test("认证连接测试的内部失败使用统一错误且不泄露本机信息", async () => {
	const app = createApp({
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {},
			testAuthConnection: async () => {
				throw new Error("/Users/private/.pi/agent/auth.json sk-auth-should-not-leak");
			},
		},
		mode: "test",
	});
	const res = await app.request("/api/auth/test", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "anthropic" }),
	});

	assert.equal(res.status, 500);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "INTERNAL_ERROR");
	assert.equal(json.message, "服务器内部错误");
	const body = JSON.stringify(json);
	assert.equal(body.includes("/Users/private"), false);
	assert.equal(body.includes("sk-auth-should-not-leak"), false);
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
