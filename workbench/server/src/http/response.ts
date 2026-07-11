import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
	errorCodeToHttpStatus,
	failure,
	success,
	type ErrorDetails,
	type WorkbenchErrorCode,
} from "@llm-wiki/workbench-contracts";

/**
 * 写成功 envelope：`{ ok: true, data }`，HTTP 200。
 * 普通 JSON 接口成功一律走这个 helper，替代历史 `{ ok: true, items / active / ... }`。
 */
export function jsonOk<T>(c: Context, data: T): Response {
	return c.json(success(data));
}

/**
 * 写失败 envelope：`{ ok: false, code, message, details? }`。
 * HTTP 状态码由 code 决定（errorCodeToHttpStatus）。
 */
export function jsonError(
	c: Context,
	code: WorkbenchErrorCode,
	message: string,
	details?: ErrorDetails,
): Response {
	return c.json(
		failure(code, message, details),
		errorCodeToHttpStatus[code] as ContentfulStatusCode,
	);
}
