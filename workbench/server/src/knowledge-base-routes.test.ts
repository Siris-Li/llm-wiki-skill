import assert from "node:assert/strict";
import test from "node:test";

import type {
	ActiveKnowledgeBaseData,
	InspectKnowledgeBasePathData,
	KnowledgeBaseInfo,
	RegisterExternalKnowledgeBaseData,
	UnregisterExternalKnowledgeBaseData,
} from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import { resolveKnowledgeBaseContext } from "./http/knowledge-base-context.js";
import type { KnowledgeBaseRouteService } from "./routes/knowledge-bases.js";

type EnvelopeJson = {
	ok?: boolean;
	code?: string;
	message?: string;
	details?: Record<string, unknown>;
	data?: unknown;
};

const registeredKb: KnowledgeBaseInfo = {
	path: "/fake/default/registered",
	name: "registered",
	origin: "default",
	valid: true,
};

const externalKb: KnowledgeBaseInfo = {
	path: "/fake/external/notes",
	name: "notes",
	origin: "external",
	valid: true,
};

const activeData: ActiveKnowledgeBaseData = {
	active: {
		kb: { path: registeredKb.path, name: registeredKb.name },
		conversation: {
			id: "conversation-1",
			isNew: false,
			messages: [
				{
					id: "u-0",
					role: "user",
					content: "你好",
					tools: [],
				},
			],
		},
		model: { provider: "anthropic", id: "claude-sonnet" },
	},
};

interface FakeOptions {
	active?: ActiveKnowledgeBaseData;
	registered?: ReadonlySet<string>;
	forbidden?: ReadonlySet<string>;
}

function createFakeService(options: FakeOptions = {}) {
	let active = options.active ?? { active: null };
	const registered = options.registered ?? new Set([registeredKb.path, externalKb.path]);
	const forbidden = options.forbidden ?? new Set<string>();
	const calls = {
		selected: [] as string[],
		watched: [] as string[],
		cleared: 0,
		stopped: 0,
		registered: [] as string[],
		unregistered: [] as string[],
		inspected: [] as string[],
	};

	const assertSelectable = (kbPath: string) => {
		if (forbidden.has(kbPath)) {
			throw Object.assign(new Error("private path"), {
				code: "FORBIDDEN_PATH",
				details: { reason: "outside-root" },
			});
		}
		if (!registered.has(kbPath)) {
			throw Object.assign(new Error("not registered"), {
				code: "KB_NOT_REGISTERED",
			});
		}
	};

	const service: KnowledgeBaseRouteService = {
		listKnowledgeBases: async () => [registeredKb, externalKb],
		registerExternalKnowledgeBase: async (
			path: string,
		): Promise<RegisterExternalKnowledgeBaseData> => {
			calls.registered.push(path);
			if (forbidden.has(path)) {
				throw Object.assign(new Error(`/Users/private/${path}`), {
					code: "FORBIDDEN_PATH",
					details: { reason: "outside-root" },
				});
			}
			return { registered: true, path: externalKb.path, info: externalKb };
		},
		unregisterExternalKnowledgeBase: async (
			path: string,
		): Promise<UnregisterExternalKnowledgeBaseData> => {
			calls.unregistered.push(path);
			return { removed: true, path };
		},
		inspectKnowledgeBasePath: async (
			path: string,
		): Promise<InspectKnowledgeBasePathData> => {
			calls.inspected.push(path);
			if (forbidden.has(path)) {
				throw Object.assign(new Error(`/Users/private/${path}`), {
					code: "FORBIDDEN_PATH",
					details: { reason: "symlink-escape" },
				});
			}
			return {
				exists: true,
				isDirectory: true,
				hasWikiSchema: true,
				resolvedPath: path,
			};
		},
		getActiveKnowledgeBase: () => active,
		assertRegisteredKnowledgeBase: async (kbPath: string) => {
			assertSelectable(kbPath);
			return kbPath;
		},
		selectKnowledgeBase: async (kbPath: string) => {
			assertSelectable(kbPath);
			calls.selected.push(kbPath);
			active = activeData;
			return activeData;
		},
		clearActiveKnowledgeBase: async () => {
			calls.cleared += 1;
			active = { active: null };
		},
		watchKnowledgeBaseGraph: (kbPath: string) => {
			calls.watched.push(kbPath);
		},
		stopKnowledgeBaseGraphWatcher: () => {
			calls.stopped += 1;
		},
	};
	return { service, calls };
}

async function json(res: Response): Promise<EnvelopeJson> {
	return (await res.json()) as EnvelopeJson;
}

test("知识库 route 使用 fake service 返回统一列表、active 与管理 envelope", async () => {
	const { service, calls } = createFakeService({ active: activeData });
	const app = createApp({ knowledgeBaseService: service });

	const listRes = await app.request("/api/knowledge-bases");
	assert.equal(listRes.status, 200);
	assert.deepEqual((await json(listRes)).data, [registeredKb, externalKb]);

	const activeRes = await app.request("/api/knowledge-base");
	assert.equal(activeRes.status, 200);
	assert.deepEqual((await json(activeRes)).data, activeData);

	const registerRes = await app.request("/api/knowledge-bases/external", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path: " /fake/external/notes " }),
	});
	assert.equal(registerRes.status, 200);
	assert.deepEqual(calls.registered, [externalKb.path]);
	assert.deepEqual((await json(registerRes)).data, {
		registered: true,
		path: externalKb.path,
		info: externalKb,
	});

	const inspectRes = await app.request("/api/knowledge-bases/inspect", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path: externalKb.path }),
	});
	assert.equal(inspectRes.status, 200);
	assert.equal((await json(inspectRes)).ok, true);
	assert.deepEqual(calls.inspected, [externalKb.path]);

	const unregisterRes = await app.request("/api/knowledge-bases/external", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path: externalKb.path }),
	});
	assert.equal(unregisterRes.status, 200);
	assert.deepEqual(calls.unregistered, [externalKb.path]);
});

test("读取 active context 在未选库时返回统一的 null active", async () => {
	const { service } = createFakeService();
	const app = createApp({ knowledgeBaseService: service });
	const res = await app.request("/api/knowledge-base");
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), {
		ok: true,
		data: { active: null },
	});
});

test("共享上下文 resolver 在未选库时返回 NO_ACTIVE_KB", async () => {
	await assert.rejects(
		() =>
			resolveKnowledgeBaseContext(
				{},
				{
					getActiveKnowledgeBasePath: () => null,
					assertRegisteredKnowledgeBase: async (kbPath) => kbPath,
				},
			),
		(err) =>
			err instanceof Error &&
			(err as Error & { code?: string }).code === "NO_ACTIVE_KB",
	);
});

test("选择 active KB 只接受 kbPath，验证登记后切换并启动 watcher", async () => {
	const { service, calls } = createFakeService();
	const app = createApp({ knowledgeBaseService: service });
	const res = await app.request("/api/knowledge-base", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kbPath: registeredKb.path }),
	});
	assert.equal(res.status, 200);
	assert.deepEqual((await json(res)).data, activeData);
	assert.deepEqual(calls.selected, [registeredKb.path]);
	assert.deepEqual(calls.watched, [registeredKb.path]);

	const oldField = await app.request("/api/knowledge-base", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path: registeredKb.path }),
	});
	assert.equal(oldField.status, 400);
	assert.equal((await json(oldField)).code, "INVALID_REQUEST");
});

test("选择未登记 KB 返回 KB_NOT_REGISTERED，且不改变 active 或 watcher", async () => {
	const { service, calls } = createFakeService({ active: activeData });
	const app = createApp({ knowledgeBaseService: service });
	const res = await app.request("/api/knowledge-base", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kbPath: "/fake/unregistered" }),
	});
	assert.equal(res.status, 404);
	assert.deepEqual(await json(res), {
		ok: false,
		code: "KB_NOT_REGISTERED",
		message: "知识库未登记或已失效",
	});
	assert.deepEqual(calls.selected, []);
	assert.deepEqual(calls.watched, []);
	assert.deepEqual(service.getActiveKnowledgeBase(), activeData);
});

test("forbidden path 返回脱敏 FORBIDDEN_PATH，不泄露本地绝对路径", async () => {
	const privatePath = "/fake/private";
	const { service } = createFakeService({ forbidden: new Set([privatePath]) });
	const app = createApp({ knowledgeBaseService: service });
	for (const [url, method, body] of [
		["/api/knowledge-bases/inspect", "POST", { path: privatePath }],
		["/api/knowledge-bases/external", "POST", { path: privatePath }],
		["/api/knowledge-base", "POST", { kbPath: privatePath }],
	] as const) {
		const res = await app.request(url, {
			method,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		assert.equal(res.status, 403);
		const payload = await json(res);
		assert.equal(payload.ok, false);
		assert.equal(payload.code, "FORBIDDEN_PATH");
		assert.equal(payload.message, "路径不在允许的知识库边界内");
		assert.equal(
			["outside-root", "symlink-escape"].includes(
				String(payload.details?.reason),
			),
			true,
		);
		assert.equal(JSON.stringify(payload).includes("/Users/"), false);
		assert.equal(JSON.stringify(payload).includes(privatePath), false);
	}
});

test("清除 active context 同时清理会话与 graph watcher", async () => {
	const { service, calls } = createFakeService({ active: activeData });
	const app = createApp({ knowledgeBaseService: service });
	const res = await app.request("/api/knowledge-base", { method: "DELETE" });
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), { ok: true, data: { active: null } });
	assert.equal(calls.cleared, 1);
	assert.equal(calls.stopped, 1);
});

test("未知知识库服务错误返回脱敏 INTERNAL_ERROR", async () => {
	const { service } = createFakeService();
	service.registerExternalKnowledgeBase = async (
		_path: string,
	): Promise<RegisterExternalKnowledgeBaseData> => {
		throw new Error("/Users/private/config.json api_key=sk-do-not-leak");
	};
	const app = createApp({ knowledgeBaseService: service });
	const res = await app.request("/api/knowledge-bases/external", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path: "/fake/external" }),
	});
	assert.equal(res.status, 500);
	assert.deepEqual(await json(res), {
		ok: false,
		code: "INTERNAL_ERROR",
		message: "服务器内部错误",
	});
});

test("知识库 body 使用统一 JSON/schema 校验且不回显原始 body", async () => {
	const { service } = createFakeService();
	const app = createApp({ knowledgeBaseService: service });
	const invalidJson = await app.request("/api/knowledge-base", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{bad",
	});
	assert.equal((await json(invalidJson)).code, "INVALID_JSON");

	const invalidRequest = await app.request("/api/knowledge-bases/external", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path: "", secret: "sk-do-not-echo" }),
	});
	const payload = await json(invalidRequest);
	assert.equal(payload.code, "INVALID_REQUEST");
	assert.equal(JSON.stringify(payload).includes("sk-do-not-echo"), false);
});
