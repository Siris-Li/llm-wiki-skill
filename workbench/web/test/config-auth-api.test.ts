import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { ApiError, ContractMismatchError } from "../src/lib/api/client";
import { fetchAvailableModels, getConfig, setConfig } from "../src/lib/api/config";
import { getAuthStatus, setAuthKey, testAuthConnection } from "../src/lib/api/auth";

function stubFetch(body: unknown, status = 200) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = ((input: URL | string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof globalThis.fetch;
	return calls;
}

describe("config / auth API modules", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("getConfig 通过统一 client 读取 /api/config 的 data", async () => {
		const calls = stubFetch({
			ok: true,
			data: {
				version: 1,
				externalKnowledgeBases: [],
				showUserGlobalSkills: true,
			},
		});
		const config = await getConfig();
		assert.equal(calls[0]?.url, "/api/config");
		assert.equal(calls[0]?.init?.method, "GET");
		assert.equal(config.showUserGlobalSkills, true);
	});

	it("setConfig 用 POST JSON body，并返回统一 envelope data", async () => {
		const calls = stubFetch({
			ok: true,
			data: {
				version: 1,
				externalKnowledgeBases: [],
				modelRoles: { main: null },
			},
		});
		const config = await setConfig({ modelRoles: { main: null } });
		assert.equal(calls[0]?.url, "/api/config");
		assert.equal(calls[0]?.init?.method, "POST");
		assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { modelRoles: { main: null } });
		assert.deepEqual(config.modelRoles, { main: null });
	});

	it("fetchAvailableModels 读取 /api/models 的统一 data 数组", async () => {
		stubFetch({
			ok: true,
			data: [
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
		});
		const models = await fetchAvailableModels();
		assert.equal(models[0]?.provider, "anthropic");
	});

	it("getConfig 拒绝旧的顶层 config 成功形状", async () => {
		stubFetch({
			ok: true,
			config: {
				version: 1,
				externalKnowledgeBases: [],
				modelRoles: { main: null },
			},
		});
		await assert.rejects(
			() => getConfig(),
			(err) => err instanceof ContractMismatchError && err.path === "/api/config",
		);
	});

	it("fetchAvailableModels 拒绝旧的顶层 items 成功形状", async () => {
		stubFetch({
			ok: true,
			items: [
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
		});
		await assert.rejects(
			() => fetchAvailableModels(),
			(err) => err instanceof ContractMismatchError && err.path === "/api/models",
		);
	});

	it("getAuthStatus 读取脱敏认证状态，不接受旧的 spread 响应", async () => {
		stubFetch({
			ok: true,
			authFileExists: true,
			providers: [{ id: "anthropic", type: "api_key", configured: true }],
			envKeys: [],
		});
		await assert.rejects(() => getAuthStatus(), (err) => err instanceof ContractMismatchError);
	});

	it("getAuthStatus 返回统一 envelope data 且不暴露认证细节", async () => {
		stubFetch({
			ok: true,
			data: {
				authFileExists: true,
				providers: [{ id: "anthropic", type: "api_key", configured: true }],
				envKeys: [{ name: "ANTHROPIC_API_KEY", present: true }],
			},
		});
		const status = await getAuthStatus();
		assert.equal(status.authFileExists, true);
		const body = JSON.stringify(status);
		assert.equal(body.includes("sk-"), false);
		assert.equal(body.includes("/Users/"), false);
		assert.equal(body.includes(".pi/agent/auth.json"), false);
	});

	it("setAuthKey 通过统一 client 写入认证", async () => {
		const calls = stubFetch({ ok: true, data: { saved: true } });
		const result = await setAuthKey("anthropic", "sk-web-route-test");
		assert.equal(calls[0]?.url, "/api/auth/set");
		assert.equal(calls[0]?.init?.method, "POST");
		assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
			provider: "anthropic",
			type: "api_key",
			key: "sk-web-route-test",
		});
		assert.deepEqual(result, { saved: true });
	});

	it("testAuthConnection 通过统一 client 返回连接成功消息", async () => {
		const calls = stubFetch({ ok: true, data: { message: "连接成功，模型可用" } });
		const result = await testAuthConnection("anthropic");
		assert.equal(calls[0]?.url, "/api/auth/test");
		assert.equal(calls[0]?.init?.method, "POST");
		assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { provider: "anthropic" });
		assert.equal(result.message, "连接成功，模型可用");
	});

	it("认证写入和连接测试透出稳定错误 code", async () => {
		stubFetch({ ok: false, code: "INVALID_REQUEST", message: "请求字段不符合 schema" }, 400);
		await assert.rejects(
			() => testAuthConnection("anthropic"),
			(err) => err instanceof ApiError && err.code === "INVALID_REQUEST",
		);

		stubFetch(
			{ ok: false, code: "AUTHENTICATION_FAILED", message: "认证连接失败，请检查 API key 后重试" },
			400,
		);
		await assert.rejects(
			() => testAuthConnection("anthropic"),
			(err) => err instanceof ApiError && err.code === "AUTHENTICATION_FAILED",
		);

		stubFetch(
			{ ok: false, code: "UNSUPPORTED_PLATFORM", message: "当前平台不支持认证连接测试" },
			501,
		);
		await assert.rejects(
			() => testAuthConnection("anthropic"),
			(err) => err instanceof ApiError && err.code === "UNSUPPORTED_PLATFORM",
		);

		stubFetch({ ok: false, code: "INTERNAL_ERROR", message: "服务器内部错误" }, 500);
		await assert.rejects(
			() => setAuthKey("anthropic", "sk-web-route-test"),
			(err) => err instanceof ApiError && err.code === "INTERNAL_ERROR",
		);
	});

	it("认证领域调用拒绝旧的成功响应", async () => {
		stubFetch({ ok: true, message: "连接成功，模型可用" });
		await assert.rejects(
			() => testAuthConnection("anthropic"),
			(err) => err instanceof ContractMismatchError,
		);
	});

	it("失败 envelope 由领域 module 透出 ApiError code", async () => {
		stubFetch({ ok: false, code: "INTERNAL_ERROR", message: "服务器内部错误" }, 500);
		await assert.rejects(
			() => getConfig(),
			(err) => err instanceof ApiError && err.code === "INTERNAL_ERROR",
		);
	});
});
