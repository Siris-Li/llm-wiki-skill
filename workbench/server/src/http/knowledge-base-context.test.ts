import assert from "node:assert/strict";
import test from "node:test";

import { HttpContractError } from "./request.js";
import { resolveKnowledgeBaseContext } from "./knowledge-base-context.js";

const deps = {
	getActiveKnowledgeBasePath: () => "/kb/active",
	assertRegisteredKnowledgeBase: async (kbPath: string) => {
		if (kbPath === "/kb/missing") {
			throw new HttpContractError(
				"KB_NOT_REGISTERED",
				"知识库未登记或已失效",
			);
		}
		return kbPath;
	},
};

test("知识库上下文 query kb 优先于 body kbPath，二者缺省时回退 active", async () => {
	assert.equal(
		await resolveKnowledgeBaseContext(
			{ queryKb: " /kb/query ", body: { kbPath: "/kb/body" } },
			deps,
		),
		"/kb/query",
	);
	assert.equal(
		await resolveKnowledgeBaseContext({ body: { kbPath: " /kb/body " } }, deps),
		"/kb/body",
	);
	assert.equal(await resolveKnowledgeBaseContext({}, deps), "/kb/active");
});

test("知识库上下文拒绝旧 body path 字段", async () => {
	await assert.rejects(
		() => resolveKnowledgeBaseContext({ body: { path: "/kb/legacy" } }, deps),
		(err) => err instanceof HttpContractError && err.code === "INVALID_REQUEST",
	);
});

test("知识库上下文无 active 与未登记路径返回稳定 code", async () => {
	await assert.rejects(
		() =>
			resolveKnowledgeBaseContext(
				{},
				{ ...deps, getActiveKnowledgeBasePath: () => null },
			),
		(err) => err instanceof HttpContractError && err.code === "NO_ACTIVE_KB",
	);
	await assert.rejects(
		() => resolveKnowledgeBaseContext({ queryKb: "/kb/missing" }, deps),
		(err) => err instanceof HttpContractError && err.code === "KB_NOT_REGISTERED",
	);
});
