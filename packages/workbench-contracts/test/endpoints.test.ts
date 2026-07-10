import assert from "node:assert/strict";
import test from "node:test";

import {
	EndpointEntrySchema,
	EndpointKindSchema,
	EndpointSafetySchema,
	ENDPOINT_REGISTRY,
	isMigratedJsonPath,
	MIGRATED_JSON_PATHS,
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
	const graphEvents = ENDPOINT_REGISTRY.find(
		(e) => e.method === "GET" && e.path === "/api/events",
	);
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
	const health = ENDPOINT_REGISTRY.find(
		(e) => e.method === "GET" && e.path === "/api/health",
	);
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
