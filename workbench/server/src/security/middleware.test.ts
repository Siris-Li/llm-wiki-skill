import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../app.js";
import { CAPABILITY_TOKEN_HEADER } from "./token.js";
import { createSecurityMiddleware } from "./middleware.js";

const TOKEN = "test-capability-token-secret-do-not-log-7f3e";
const TRUSTED_ORIGIN = "http://localhost:5180";
const TRUSTED_ORIGINS = new Set([TRUSTED_ORIGIN]);

type EnvelopeJson = {
	ok?: boolean;
	code?: string;
	message?: string;
};

/**
 * 搭一个带真实 security 中间件 + 若干 registry 路径的测试 app：
 *  - GET /api/health                         read-only（createApp 自带）
 *  - GET /api/config                         read-only（#168 migrated-json）
 *  - POST /api/config                        state-changing（#168 migrated-json）
 *  - GET /api/models                         read-only（#168 migrated-json）
 *  - GET /api/auth/status                    read-only（#168 migrated-json）
 *  - POST /api/echo                          read-only（POST 不等于要 token）
 *  - GET /api/artifacts/:id/files/:filename  file-download read-only
 *  - POST /api/knowledge-bases/new           state-changing
 *  - POST /api/prompt                        state-changing（SSE 启动）
 */
function buildApp(
	token: string = TOKEN,
	trustedOrigins: ReadonlySet<string> = TRUSTED_ORIGINS,
) {
	const app = createApp({
		security: createSecurityMiddleware({ token, trustedOrigins }),
		configService: {
			loadConfig: async () => ({ version: 1, externalKnowledgeBases: [] }),
			saveConfig: async () => {},
			listAvailableModels: () => [],
			reloadActiveResources: async () => {},
		},
		authService: {
			getAuthStatus: async () => ({ authFileExists: false, providers: [], envKeys: [] }),
			setAuthKey: async () => {},
			testAuthConnection: async () => ({ ok: true, message: "连接成功，模型可用" }),
		},
		artifactService: {
			listArtifacts: () => [],
			getArtifact: () => null,
			readArtifactFile: async () => ({
				body: new TextEncoder().encode("report"),
				mimeType: "text/markdown; charset=utf-8",
				sizeBytes: 6,
			}),
		},
	});
	app.post("/api/echo", (c) => c.json({ ok: true }));
	app.post("/api/knowledge-bases/new", (c) => c.json({ ok: true }));
	app.post("/api/prompt", (c) => c.json({ ok: true }));
	return app;
}

function headers(overrides: Record<string, string> = {}): Record<string, string> {
	return overrides;
}

// ============= public / trusted read-only =============

test("public health：无需 token / 来源即放行", async () => {
	const app = buildApp();
	const res = await app.request("/api/health");
	assert.equal(res.status, 200);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, true);
});

test("public health 即便来源不可信也放行", async () => {
	const app = buildApp();
	const res = await app.request("/api/health", {
		headers: headers({ origin: "http://evil.example" }),
	});
	assert.equal(res.status, 200);
});

test("trusted read-only POST /api/echo：可信来源仍需 token", async () => {
	const app = buildApp();
	const denied = await app.request("/api/echo", {
		method: "POST",
		headers: headers({ origin: TRUSTED_ORIGIN }),
	});
	assert.equal(denied.status, 403);
	const allowed = await app.request("/api/echo", {
		method: "POST",
		headers: headers({ origin: TRUSTED_ORIGIN, [CAPABILITY_TOKEN_HEADER]: TOKEN }),
	});
	assert.equal(allowed.status, 200);
});

test("文件下载 GET：可信来源和 token 缺一不可", async () => {
	const app = buildApp();
	const path = "/api/artifacts/11111111-1111-4111-8111-111111111111/files/report.md";
	const denied = await app.request(path, { headers: headers({ origin: TRUSTED_ORIGIN }) });
	assert.equal(denied.status, 403);
	const res = await app.request(
		path,
		{ headers: headers({ origin: TRUSTED_ORIGIN, [CAPABILITY_TOKEN_HEADER]: TOKEN }) },
	);
	assert.equal(res.status, 200);
});

test("只读 graph EventSource GET：不可信来源不能观察本地事件", async () => {
	const app = buildApp();
	const res = await app.request("/api/events", {
		headers: headers({ origin: "http://evil.example" }),
	});
	assert.equal(res.status, 403);
	assert.equal(((await res.json()) as EnvelopeJson).code, "FORBIDDEN_ORIGIN");
});

test("migrated-json read-only GET：可信来源和 token 同时正确才放行", async () => {
	const app = buildApp();
	for (const path of ["/api/config", "/api/models", "/api/auth/status"]) {
		const denied = await app.request(path, { headers: headers({ origin: TRUSTED_ORIGIN }) });
		assert.equal(denied.status, 403, path);
		const res = await app.request(path, {
			headers: headers({ origin: TRUSTED_ORIGIN, [CAPABILITY_TOKEN_HEADER]: TOKEN }),
		});
		assert.equal(res.status, 200, path);
	}
});

test("浏览器同源 Fetch Metadata 仍需 token 才能读取本地内容", async () => {
	const app = buildApp();
	const denied = await app.request("/api/config", {
		headers: headers({ "sec-fetch-site": "same-origin" }),
	});
	assert.equal(denied.status, 403);
	const res = await app.request("/api/config", {
		headers: headers({
			"sec-fetch-site": "same-origin",
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	assert.equal(res.status, 200);
});

test("本地内容读取：不可信或来源缺失均拒绝", async () => {
	const app = buildApp();
	for (const requestHeaders of [undefined, headers({ origin: "http://evil.example" })]) {
		const res = await app.request("/api/config", { headers: requestHeaders });
		assert.equal(res.status, 403);
		assert.ok(
			["FORBIDDEN_ORIGIN", "FORBIDDEN_LOCAL_API"].includes(
				((await res.json()) as EnvelopeJson).code ?? "",
			),
		);
	}
});

test("null origin 不能用 same-origin Fetch Metadata 绕过 token", async () => {
	const app = buildApp();
	const denied = await app.request("/api/config", {
		headers: headers({ origin: "null", "sec-fetch-site": "same-origin" }),
	});
	assert.equal(denied.status, 403);
	const allowed = await app.request("/api/config", {
		headers: headers({
			origin: "null",
			"sec-fetch-site": "same-origin",
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	assert.equal(allowed.status, 200);
});

test("#168 migrated-json state-changing POST /api/config 缺 token -> 403 FORBIDDEN_LOCAL_API", async () => {
	const app = buildApp();
	const res = await app.request("/api/config", {
		method: "POST",
		headers: headers({ origin: TRUSTED_ORIGIN, "Content-Type": "application/json" }),
		body: JSON.stringify({ showUserGlobalSkills: true }),
	});
	assert.equal(res.status, 403);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "FORBIDDEN_LOCAL_API");
});

test("#168 migrated-json state-changing POST /api/config 带正确 token + 可信来源 -> 200", async () => {
	const app = buildApp();
	const res = await app.request("/api/config", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			"Content-Type": "application/json",
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
		body: JSON.stringify({ showUserGlobalSkills: true }),
	});
	assert.equal(res.status, 200);
});

test("#205 认证写入和连接测试同时要求可信来源与 token", async () => {
	const app = buildApp();
	for (const [path, body] of [
		["/api/auth/set", { provider: "anthropic", type: "api_key", key: "sk-test" }],
		["/api/auth/test", { provider: "anthropic" }],
	] as const) {
		const missingToken = await app.request(path, {
			method: "POST",
			headers: headers({ origin: TRUSTED_ORIGIN, "Content-Type": "application/json" }),
			body: JSON.stringify(body),
		});
		assert.equal(missingToken.status, 403, path);
		assert.equal(((await missingToken.json()) as EnvelopeJson).code, "FORBIDDEN_LOCAL_API");

		const untrusted = await app.request(path, {
			method: "POST",
			headers: headers({
				origin: "http://evil.example",
				"Content-Type": "application/json",
				[CAPABILITY_TOKEN_HEADER]: TOKEN,
			}),
			body: JSON.stringify(body),
		});
		assert.equal(untrusted.status, 403, path);
		assert.equal(((await untrusted.json()) as EnvelopeJson).code, "FORBIDDEN_ORIGIN");

		const allowed = await app.request(path, {
			method: "POST",
			headers: headers({
				origin: TRUSTED_ORIGIN,
				"Content-Type": "application/json",
				[CAPABILITY_TOKEN_HEADER]: TOKEN,
			}),
			body: JSON.stringify(body),
		});
		assert.equal(allowed.status, 200, path);
	}
});

// ============= token 校验 =============

test("state-changing POST 缺 token -> 403 FORBIDDEN_LOCAL_API", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({ origin: TRUSTED_ORIGIN }),
	});
	assert.equal(res.status, 403);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.ok, false);
	assert.equal(json.code, "FORBIDDEN_LOCAL_API");
});

test("state-changing POST token 错误 -> 403 FORBIDDEN_LOCAL_API", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			[CAPABILITY_TOKEN_HEADER]: "wrong-token",
		}),
	});
	assert.equal(res.status, 403);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.code, "FORBIDDEN_LOCAL_API");
});

test("state-changing POST 带正确 token + 可信来源 -> 200", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	assert.equal(res.status, 200);
});

test("SSE 启动 POST /api/prompt 同样要求 token（缺 -> 403）", async () => {
	const app = buildApp();
	const res = await app.request("/api/prompt", {
		method: "POST",
		headers: headers({ origin: TRUSTED_ORIGIN }),
	});
	assert.equal(res.status, 403);
	assert.equal(((await res.json()) as EnvelopeJson).code, "FORBIDDEN_LOCAL_API");
});

test("batch digest SSE 启动会触发模型，缺 token -> 403", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/batch-digest", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			"Content-Type": "application/json",
		}),
		body: JSON.stringify({ kbPath: "/fake/kb", filePaths: ["/fake/a.md"] }),
	});
	assert.equal(res.status, 403);
	assert.equal(((await res.json()) as EnvelopeJson).code, "FORBIDDEN_LOCAL_API");
});

test("未登记 endpoint 默认要求 token（fail closed，防漏网新路由）", async () => {
	const app = buildApp();
	const res = await app.request("/api/brand-new-not-registered", {
		method: "POST",
		headers: headers({ origin: TRUSTED_ORIGIN }),
	});
	assert.equal(res.status, 403);
	// 未登记路由没有 handler，但安全中间件先短路，仍返回 FORBIDDEN_LOCAL_API
	assert.equal(((await res.json()) as EnvelopeJson).code, "FORBIDDEN_LOCAL_API");
});

// ============= 来源校验（辅助 deny） =============

test("不可信来源即便带正确 token -> 403 FORBIDDEN_ORIGIN", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: "http://evil.example",
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	assert.equal(res.status, 403);
	const json = (await res.json()) as EnvelopeJson;
	assert.equal(json.code, "FORBIDDEN_ORIGIN");
});

test("明确的跨站请求即便伪装可信 Origin 并带 token 仍拒绝", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			"sec-fetch-site": "cross-site",
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	assert.equal(res.status, 403);
	assert.equal(((await res.json()) as EnvelopeJson).code, "FORBIDDEN_ORIGIN");
});

test("null origin（桌面 WebView）不单独放行：仍需 token（#9）", async () => {
	const app = buildApp();
	// null + 无 token -> 拒（不能因 null 就放行）
	const denied = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({ origin: "null" }),
	});
	assert.equal(denied.status, 403);
	assert.equal(
		((await denied.json()) as EnvelopeJson).code,
		"FORBIDDEN_LOCAL_API",
	);
	// null + 正确 token -> 放行（token 才是依据）
	const allowed = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: "null",
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	assert.equal(allowed.status, 200);
});

test("缺省 origin 的本地客户端必须用正确 token 证明可信", async () => {
	const app = buildApp();
	const res = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({ [CAPABILITY_TOKEN_HEADER]: TOKEN }),
	});
	assert.equal(res.status, 200);
});

// ============= token 不进 URL / 日志 =============

test("token 不接受经 URL query 传递：URL 带 token 仍被拒（token 不在 URL）", async () => {
	const app = buildApp();
	// token 只认请求头；放进 URL query 不生效 -> 拒绝
	const res = await app.request(
		`/api/knowledge-bases/new?token=${encodeURIComponent(TOKEN)}`,
		{ method: "POST", headers: headers({ origin: TRUSTED_ORIGIN }) },
	);
	assert.equal(res.status, 403);
	assert.equal(
		((await res.json()) as EnvelopeJson).code,
		"FORBIDDEN_LOCAL_API",
	);
});

test("错误 token 的失败 envelope 不回显 token；成功响应也不含 token", async () => {
	const app = buildApp();
	const denied = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			[CAPABILITY_TOKEN_HEADER]: "wrong-token",
		}),
	});
	const deniedBody = JSON.stringify(await denied.json());
	assert.equal(deniedBody.includes(TOKEN), false);

	const allowed = await app.request("/api/knowledge-bases/new", {
		method: "POST",
		headers: headers({
			origin: TRUSTED_ORIGIN,
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
		}),
	});
	const allowedBody = JSON.stringify(await allowed.json());
	assert.equal(allowedBody.includes(TOKEN), false);
});

test("请求处理过程中 token 不写入任何 console 输出（不进日志）", async () => {
	const app = buildApp();
	const sink: string[] = [];
	const originals = {
		log: console.log,
		warn: console.warn,
		error: console.error,
		info: console.info,
		debug: console.debug,
	};
	const tap = (...args: unknown[]) => void sink.push(args.map(String).join(" "));
	Object.assign(console, { log: tap, warn: tap, error: tap, info: tap, debug: tap });
	try {
		await app.request("/api/knowledge-bases/new", {
			method: "POST",
			headers: headers({
				origin: TRUSTED_ORIGIN,
				[CAPABILITY_TOKEN_HEADER]: TOKEN,
			}),
		});
	} finally {
		Object.assign(console, originals);
	}
	const combined = sink.join("\n");
	assert.equal(
		combined.includes(TOKEN),
		false,
		"capability token 不得出现在任何 console 日志中",
	);
});
