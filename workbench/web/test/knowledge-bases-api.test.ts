import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { ApiError, ContractMismatchError } from "../src/lib/api/client";
import {
	clearActiveContext,
	getActiveContext,
	inspectKnowledgeBasePath,
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	selectKnowledgeBase,
	unregisterExternalKnowledgeBase,
} from "../src/lib/api/knowledge-bases";

const knowledgeBase = {
	path: "/kb/registered",
	name: "registered",
	origin: "external" as const,
	valid: true,
};

const active = {
	kb: { path: knowledgeBase.path, name: knowledgeBase.name },
	conversation: { id: "conversation-1", isNew: false, messages: [] },
	model: null,
};

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

function requestBody(calls: Array<{ url: string; init?: RequestInit }>): unknown {
	return JSON.parse(String(calls[0]?.init?.body));
}

describe("knowledge bases / active context API module", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("列表与 active context 只接受统一 envelope data", async () => {
		let calls = stubFetch({ ok: true, data: [knowledgeBase] });
		assert.deepEqual(await listKnowledgeBases(), [knowledgeBase]);
		assert.equal(calls[0]?.url, "/api/knowledge-bases");
		assert.equal(calls[0]?.init?.method, "GET");

		calls = stubFetch({ ok: true, data: { active } });
		assert.deepEqual(await getActiveContext(), active);
		assert.equal(calls[0]?.url, "/api/knowledge-base");
	});

	it("selectKnowledgeBase 用 kbPath body 表达统一上下文入口", async () => {
		const calls = stubFetch({ ok: true, data: { active } });
		assert.deepEqual(await selectKnowledgeBase(knowledgeBase.path), active);
		assert.equal(calls[0]?.url, "/api/knowledge-base");
		assert.equal(calls[0]?.init?.method, "POST");
		assert.deepEqual(requestBody(calls), { kbPath: knowledgeBase.path });
	});

	it("登记、检查、取消登记继续用 path body，并统一解析 data", async () => {
		let calls = stubFetch({
			ok: true,
			data: { registered: true, path: knowledgeBase.path, info: knowledgeBase },
		});
		assert.deepEqual(await registerExternalKnowledgeBase(knowledgeBase.path), {
			registered: true,
			info: knowledgeBase,
		});
		assert.equal(calls[0]?.url, "/api/knowledge-bases/external");
		assert.equal(calls[0]?.init?.method, "POST");
		assert.deepEqual(requestBody(calls), { path: knowledgeBase.path });

		calls = stubFetch({
			ok: true,
			data: {
				exists: true,
				isDirectory: true,
				hasWikiSchema: true,
				resolvedPath: knowledgeBase.path,
			},
		});
		assert.equal((await inspectKnowledgeBasePath(knowledgeBase.path)).hasWikiSchema, true);
		assert.equal(calls[0]?.url, "/api/knowledge-bases/inspect");
		assert.deepEqual(requestBody(calls), { path: knowledgeBase.path });

		calls = stubFetch({
			ok: true,
			data: { removed: true, path: knowledgeBase.path },
		});
		assert.deepEqual(await unregisterExternalKnowledgeBase(knowledgeBase.path), {
			removed: true,
		});
		assert.equal(calls[0]?.init?.method, "DELETE");
		assert.deepEqual(requestBody(calls), { path: knowledgeBase.path });
	});

	it("clearActiveContext 校验响应，不再吞掉失败", async () => {
		const calls = stubFetch({ ok: true, data: { active: null } });
		await clearActiveContext();
		assert.equal(calls[0]?.url, "/api/knowledge-base");
		assert.equal(calls[0]?.init?.method, "DELETE");

		stubFetch(
			{ ok: false, code: "FORBIDDEN_LOCAL_API", message: "缺少 capability token" },
			403,
		);
		await assert.rejects(
			() => clearActiveContext(),
			(err) => err instanceof ApiError && err.code === "FORBIDDEN_LOCAL_API",
		);
	});

	it("no active 返回 null；not registered / forbidden path 透出稳定 code 与 typed details", async () => {
		stubFetch({ ok: true, data: { active: null } });
		assert.equal(await getActiveContext(), null);

		stubFetch(
			{ ok: false, code: "KB_NOT_REGISTERED", message: "知识库未登记或已失效" },
			404,
		);
		await assert.rejects(
			() => selectKnowledgeBase("/kb/missing"),
			(err) => err instanceof ApiError && err.code === "KB_NOT_REGISTERED",
		);

		stubFetch(
			{
				ok: false,
				code: "FORBIDDEN_PATH",
				message: "路径不在允许的知识库边界内",
				details: { reason: "outside-root" },
			},
			403,
		);
		await assert.rejects(
			() => inspectKnowledgeBasePath("/private"),
			(err) =>
				err instanceof ApiError &&
				err.code === "FORBIDDEN_PATH" &&
				(err.details as { reason?: string })?.reason === "outside-root",
		);
	});

	it("拒绝旧 top-level items / active 响应", async () => {
		stubFetch({ ok: true, items: [knowledgeBase] });
		await assert.rejects(
			() => listKnowledgeBases(),
			(err) => err instanceof ContractMismatchError,
		);

		stubFetch({ ok: true, active });
		await assert.rejects(
			() => getActiveContext(),
			(err) => err instanceof ContractMismatchError,
		);
	});
});
