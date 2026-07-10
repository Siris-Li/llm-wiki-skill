import assert from "node:assert/strict";
import test from "node:test";

import {
	AppConfigSchema,
	AuthStatusDataSchema,
	AvailableModelsDataSchema,
	ConflictDetailsSchema,
	errorCodeToHttpStatus,
	FailureEnvelopeSchema,
	failure,
	ForbiddenPathDetailsSchema,
	HealthDataSchema,
	InvalidRequestDetailsSchema,
	JsonEnvelopeSchema,
	MissingFieldDetailsSchema,
	ModelRefSchema,
	NotFoundDetailsSchema,
	SuccessEnvelopeSchema,
	success,
	WorkbenchErrorCodeSchema,
} from "../src/index.js";

test("WorkbenchErrorCode 包含第一批稳定错误码", () => {
	const codes = WorkbenchErrorCodeSchema.options;
	for (const expected of [
		"INVALID_JSON",
		"INVALID_REQUEST",
		"MISSING_FIELD",
		"NO_ACTIVE_KB",
		"KB_NOT_REGISTERED",
		"FORBIDDEN_PATH",
		"FORBIDDEN_ORIGIN",
		"FORBIDDEN_LOCAL_API",
		"NOT_FOUND",
		"CONFLICT",
		"UNSUPPORTED_PLATFORM",
		"BUSY",
		"INTERNAL_ERROR",
	]) {
		assert.ok(codes.includes(expected as never), `missing code ${expected}`);
	}
});

test("errorCodeToHttpStatus 覆盖所有 code 且只用 spec 约定的大类状态码", () => {
	const allowed = [400, 403, 404, 409, 500, 501];
	for (const code of WorkbenchErrorCodeSchema.options) {
		const status = errorCodeToHttpStatus[code];
		assert.ok(allowed.includes(status), `${code} -> ${status}`);
	}
	assert.equal(errorCodeToHttpStatus.NOT_FOUND, 404);
	assert.equal(errorCodeToHttpStatus.FORBIDDEN_PATH, 403);
	assert.equal(errorCodeToHttpStatus.FORBIDDEN_ORIGIN, 403);
	assert.equal(errorCodeToHttpStatus.CONFLICT, 409);
	assert.equal(errorCodeToHttpStatus.BUSY, 409);
	assert.equal(errorCodeToHttpStatus.UNSUPPORTED_PLATFORM, 501);
	assert.equal(errorCodeToHttpStatus.INTERNAL_ERROR, 500);
});

test("成功 envelope 接受 { ok: true, data } 并保留 data", () => {
	const schema = SuccessEnvelopeSchema(HealthDataSchema);
	const parsed = schema.parse({
		ok: true,
		data: { status: "ok", timestamp: 1, service: "s" },
	});
	assert.deepEqual(parsed.data, {
		status: "ok",
		timestamp: 1,
		service: "s",
	});
});

test("失败 envelope 接受 { ok: false, code, message, details? }", () => {
	assert.equal(
		FailureEnvelopeSchema.safeParse({
			ok: false,
			code: "MISSING_FIELD",
			message: "缺少 path",
		}).success,
		true,
	);
	assert.equal(
		FailureEnvelopeSchema.safeParse({
			ok: false,
			code: "INVALID_REQUEST",
			message: "x",
			details: { issues: [{ path: "name", message: "required" }] },
		}).success,
		true,
	);
});

test("失败 envelope 拒绝未知 code 和缺字段", () => {
	assert.equal(
		FailureEnvelopeSchema.safeParse({ ok: false, code: "NOPE", message: "x" })
			.success,
		false,
	);
	assert.equal(
		FailureEnvelopeSchema.safeParse({ ok: false, code: "NOT_FOUND" }).success,
		false,
	);
});

test("JsonEnvelopeSchema 按 ok 判别，能区分成功/失败", () => {
	const schema = JsonEnvelopeSchema(HealthDataSchema);
	assert.equal(
		schema.safeParse({
			ok: true,
			data: { status: "ok", timestamp: 1, service: "s" },
		}).success,
		true,
	);
	assert.equal(
		schema.safeParse({ ok: false, code: "BUSY", message: "忙" }).success,
		true,
	);
});

test("success() / failure() helper 构造正确结构", () => {
	assert.deepEqual(success(1), { ok: true, data: 1 });
	assert.deepEqual(failure("NOT_FOUND", "找不到"), {
		ok: false,
		code: "NOT_FOUND",
		message: "找不到",
	});
	assert.deepEqual(failure("MISSING_FIELD", "缺少", { field: "path" }), {
		ok: false,
		code: "MISSING_FIELD",
		message: "缺少",
		details: { field: "path" },
	});
});

test("typed details schema 校验结构化形状", () => {
	assert.equal(
		MissingFieldDetailsSchema.safeParse({ field: "path" }).success,
		true,
	);
	assert.equal(MissingFieldDetailsSchema.safeParse({ field: 1 }).success, false);

	const issues = InvalidRequestDetailsSchema.parse({
		issues: [{ path: "name", message: "required" }],
	});
	assert.equal(issues.issues.length, 1);

	assert.equal(
		ForbiddenPathDetailsSchema.safeParse({ reason: "outside-root" }).success,
		true,
	);
	// FORBIDDEN_PATH reason 是固定枚举：拒绝把本机绝对路径塞进 reason
	assert.equal(
		ForbiddenPathDetailsSchema.safeParse({ reason: "/Users/leak" }).success,
		false,
	);

	assert.equal(
		NotFoundDetailsSchema.safeParse({ resource: "kb:demo" }).success,
		true,
	);
	assert.equal(
		ConflictDetailsSchema.safeParse({ conflicts: ["purpose.md"] }).success,
		true,
	);
});

test("ModelRef schema trim provider/modelId 且拒绝空字符串", () => {
	assert.deepEqual(
		ModelRefSchema.parse({ provider: " anthropic ", modelId: " claude-sonnet " }),
		{ provider: "anthropic", modelId: "claude-sonnet" },
	);
	assert.equal(
		ModelRefSchema.safeParse({ provider: " ", modelId: "claude-sonnet" }).success,
		false,
	);
	assert.equal(
		ModelRefSchema.safeParse({ provider: "anthropic", modelId: "" }).success,
		false,
	);
});

test("config / models / auth status data schema 校验公开响应 shape", () => {
	assert.equal(
		AppConfigSchema.safeParse({
			version: 1,
			externalKnowledgeBases: [],
			showUserGlobalSkills: true,
			modelRoles: { main: { provider: "anthropic", modelId: "claude-sonnet" }, digest: null },
			uiPrefs: { sidebarExpandedKbs: ["/kb/demo"] },
		}).success,
		true,
	);
	assert.equal(
		AvailableModelsDataSchema.safeParse([
			{
				provider: "anthropic",
				modelId: "claude-sonnet",
				name: "Claude Sonnet",
				reasoning: false,
				contextWindow: 200000,
				cost: { input: 3, output: 15 },
				hasAuth: true,
			},
		]).success,
		true,
	);
	assert.equal(
		AuthStatusDataSchema.safeParse({
			authFileExists: true,
			providers: [{ id: "anthropic", type: "api_key", configured: true }],
			envKeys: [{ name: "ANTHROPIC_API_KEY", present: false }],
		}).success,
		true,
	);
});

test("HealthData schema 校验心跳 data", () => {
	assert.equal(
		HealthDataSchema.safeParse({
			status: "ok",
			timestamp: 100,
			service: "s",
		}).success,
		true,
	);
	// status 不是 'ok' / timestamp 非正整数 都拒绝
	assert.equal(
		HealthDataSchema.safeParse({
			status: "down",
			timestamp: 100,
			service: "s",
		}).success,
		false,
	);
	assert.equal(
		HealthDataSchema.safeParse({
			status: "ok",
			timestamp: -1,
			service: "s",
		}).success,
		false,
	);
});
