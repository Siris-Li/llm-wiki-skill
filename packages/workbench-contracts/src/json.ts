import { z } from "zod";

import { ErrorDetailsSchema, WorkbenchErrorCodeSchema } from "./errors.js";
import type { ErrorDetails, WorkbenchErrorCode } from "./errors.js";

/**
 * 成功 envelope schema 工厂：`{ ok: true, data: Data }`。
 * data 由调用方传入具体领域 schema。普通 JSON 接口成功一律走这个结构，
 * 替代历史 `{ ok: true, items / active / config / content / ... }` 混用。
 */
export function SuccessEnvelopeSchema<Data>(data: z.ZodType<Data>) {
	return z.object({
		ok: z.literal(true),
		data,
	});
}
export type SuccessEnvelope<Data> = { ok: true; data: Data };

/**
 * 失败 envelope schema：`{ ok: false, code, message, details? }`。
 * details 形状宽松（见 errors.ErrorDetailsSchema），具体结构由 per-code
 * schema 在构造方保证。
 */
export const FailureEnvelopeSchema = z.object({
	ok: z.literal(false),
	code: WorkbenchErrorCodeSchema,
	message: z.string(),
	details: ErrorDetailsSchema.optional(),
});
export type FailureEnvelope = {
	ok: false;
	code: WorkbenchErrorCode;
	message: string;
	details?: ErrorDetails;
};

/**
 * 普通 JSON 接口的完整 envelope（按 `ok` 判别联合）。
 * 文件下载成功返回文件 Response，不包 envelope；SSE 不套 envelope。
 */
export function JsonEnvelopeSchema<Data>(data: z.ZodType<Data>) {
	return z.discriminatedUnion("ok", [
		SuccessEnvelopeSchema(data),
		FailureEnvelopeSchema,
	]);
}

/** 构造成功 envelope。后端 response helper 与测试 mock 都用这个。 */
export function success<Data>(data: Data): SuccessEnvelope<Data> {
	return { ok: true, data };
}

/** 构造失败 envelope。details 省略时不写入字段。 */
export function failure(
	code: WorkbenchErrorCode,
	message: string,
	details?: ErrorDetails,
): FailureEnvelope {
	return details === undefined
		? { ok: false, code, message }
		: { ok: false, code, message, details };
}
