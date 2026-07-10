import assert from "node:assert/strict";
import test from "node:test";

import {
	EndpointEntrySchema,
	EndpointKindSchema,
	EndpointSafetySchema,
	ENDPOINT_REGISTRY,
	findEndpoint,
	isMigratedJsonPath,
	isReadOnly,
	MIGRATED_JSON_PATHS,
	requiresToken,
} from "../src/index.js";

test("ENDPOINT_REGISTRY 每条 entry 形状合法", () => {
	assert.ok(ENDPOINT_REGISTRY.length > 0);
	for (const entry of ENDPOINT_REGISTRY) {
		const parsed = EndpointEntrySchema.safeParse(entry);
		assert.ok(parsed.success, `invalid entry ${entry.method} ${entry.path}`);
	}
});

test("method + path 在 registry 中唯一（没有重复登记）", () => {
	const seen = new Set<string>();
	for (const entry of ENDPOINT_REGISTRY) {
		const key = `${entry.method} ${entry.path}`;
		assert.ok(!seen.has(key), `duplicate endpoint ${key}`);
		seen.add(key);
	}
});

test("registry 覆盖四类 endpoint kind", () => {
	const kinds = new Set(ENDPOINT_REGISTRY.map((e) => e.kind));
	for (const expected of EndpointKindSchema.options) {
		assert.ok(kinds.has(expected), `missing kind ${expected}`);
	}
});

test("registry 覆盖两类 safety 分类", () => {
	const safeties = new Set(ENDPOINT_REGISTRY.map((e) => e.safety));
	for (const expected of EndpointSafetySchema.options) {
		assert.ok(safeties.has(expected), `missing safety ${expected}`);
	}
});

test("file-download 与 sse 作为显式例外进入 registry", () => {
	const fileDownload = ENDPOINT_REGISTRY.filter((e) => e.kind === "file-download");
	assert.equal(fileDownload.length, 1);
	assert.equal(fileDownload[0].path, "/api/artifacts/:id/files/:filename");
	assert.equal(fileDownload[0].safety, "read-only");

	const sse = ENDPOINT_REGISTRY.filter((e) => e.kind === "sse");
	assert.ok(sse.length >= 2, "至少有 prompt 与 batch-digest 两条 SSE");
	// POST 启动型 SSE 会触发模型，必须要求 token（spec §9：会触发模型的 SSE 启动必须 POST + token）
	const postSse = sse.filter((e) => e.method === "POST");
	assert.ok(postSse.length >= 2);
	for (const entry of postSse) {
		assert.equal(
			entry.safety,
			"state-changing",
			`POST SSE 启动 ${entry.path} 必须要求 token`,
		);
	}
	// GET /api/events 是 EventSource 只读流（spec §9：保持只读），登记为 read-only sse
	const graphEvents = findEndpoint("GET", "/api/events");
	assert.equal(graphEvents?.kind, "sse");
	assert.equal(graphEvents?.safety, "read-only");
});

test("MIGRATED_JSON_PATHS 与 registry 的 migrated-json 子集严格一致（单一来源）", () => {
	const expected = ENDPOINT_REGISTRY.filter((e) => e.kind === "migrated-json").map(
		(e) => e.path,
	);
	assert.deepEqual([...MIGRATED_JSON_PATHS], expected);
});

test("health 是当前唯一 migrated-json endpoint 且只读", () => {
	const migrated = ENDPOINT_REGISTRY.filter((e) => e.kind === "migrated-json");
	assert.deepEqual(
		migrated.map((e) => e.path),
		["/api/health"],
	);
	const health = findEndpoint("GET", "/api/health");
	assert.equal(health?.kind, "migrated-json");
	assert.equal(health?.safety, "read-only");
});

test("isMigratedJsonPath 接受 migrated-json、拒绝 legacy path", () => {
	assert.equal(isMigratedJsonPath("/api/health"), true);
	// legacy endpoint 必须返回 false —— 这是"新 client 不误处理 legacy"的数据层防线
	assert.equal(isMigratedJsonPath("/api/knowledge-bases"), false);
	assert.equal(isMigratedJsonPath("/api/prompt"), false); // sse，不是 migrated-json
	assert.equal(
		isMigratedJsonPath("/api/artifacts/x/files/y.md"),
		false, // file-download，不是 migrated-json
	);
});

test("findEndpoint 精确匹配静态 path", () => {
	assert.equal(findEndpoint("GET", "/api/health")?.path, "/api/health");
	assert.equal(findEndpoint("POST", "/api/echo")?.path, "/api/echo");
	// method 不匹配
	assert.equal(findEndpoint("POST", "/api/health"), undefined);
});

test("findEndpoint 按 :param 动态段匹配", () => {
	assert.equal(
		findEndpoint("GET", "/api/artifacts/abc/files/x.md")?.path,
		"/api/artifacts/:id/files/:filename",
	);
	assert.equal(
		findEndpoint("GET", "/api/artifacts/abc")?.path,
		"/api/artifacts/:id",
	);
	// 动态段不跨 /，非法多段不匹配
	assert.equal(findEndpoint("GET", "/api/artifacts/a/b/files/c"), undefined);
});

test("isReadOnly 按查询返回，未登记 endpoint 默认 state-changing（安全默认）", () => {
	assert.equal(isReadOnly("GET", "/api/health"), true); // read-only
	assert.equal(isReadOnly("GET", "/api/knowledge-bases"), true); // legacy read-only
	assert.equal(isReadOnly("POST", "/api/knowledge-bases/external"), false); // state-changing
	assert.equal(isReadOnly("DELETE", "/api/knowledge-base"), false);
	assert.equal(isReadOnly("GET", "/api/artifacts/abc/files/x.md"), true); // file-download read-only
	// 未登记的任意 path 默认要求 token（保守拒绝）
	assert.equal(isReadOnly("POST", "/api/unknown-route"), false);
	assert.equal(isReadOnly("GET", "/api/brand-new"), false);
});

test("requiresToken 是 isReadOnly 的反", () => {
	assert.equal(requiresToken("GET", "/api/health"), false);
	assert.equal(requiresToken("POST", "/api/config"), true);
	assert.equal(requiresToken("POST", "/api/unknown"), true); // 未登记默认要 token
});
