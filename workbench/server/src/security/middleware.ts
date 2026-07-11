import { timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import { requiresCapabilityToken } from "@llm-wiki/workbench-contracts";

import { jsonError } from "../http/response.js";
import { CAPABILITY_TOKEN_HEADER } from "./token.js";

/** 桌面 WebView 会发出的字面量 "null" origin（spec §9）。 */
const NULL_ORIGIN = "null";

export interface SecurityMiddlewareOptions {
	/** 本次启动生成的 capability token（首要防线）。 */
	token: string;
	/**
	 * 可信来源 Origin 集合（仅作辅助 deny 信号）。dev 默认含 web origin；
	 * 桌面壳将来追加桌面 origin。
	 *
	 * 注意：即便 origin 在白名单内，会改状态的 endpoint 仍要求 token —— origin
	 * 绝不作唯一安全依据（spec §9 / #10）。
	 */
	trustedOrigins: ReadonlySet<string>;
}

/** timing-safe 比较 token：长度不同先返回 false（避免 timingSafeEqual 抛错）。 */
function tokenMatches(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * 本地 API 统一安全入口中间件（#166）。
 *
 * 判定以 @llm-wiki/workbench-contracts 的 ENDPOINT_REGISTRY 为单一来源
 *（`requiresCapabilityToken` 派生自 registry，不维护第二份分类表）：
 *
 *  - read-only endpoint（health / 只读 SSE / 文件下载 / 各类 list·read）→ 显式
 *    白名单，豁免 token 与来源检查。
 *  - state-changing endpoint（含未登记，fail closed）→ 必须同时满足：
 *      1. 来源不是“已知的不可信”：Origin 缺省 / "null"（桌面 WebView）/ 在白名单
 *         内都放行进入下一步；出现且非 null 且不在白名单 → FORBIDDEN_ORIGIN。
 *      2. 携带与本次启动一致的 capability token（timing-safe）→ 否则
 *         FORBIDDEN_LOCAL_API。
 *
 * 设计要点（spec §9 / #9 / #10）：
 *  - token 是首要且充分的防线；Origin 仅作辅助 deny，绝不作唯一依据。
 *  - null origin 不能单独放行：仍必须带 token（走第 2 步）。
 *  - 未登记 endpoint 默认要求 token，避免新增状态改写路由漏过检查。
 *  - 失败一律走统一 error envelope + 稳定 code（spec §9）。
 */
export function createSecurityMiddleware(
	options: SecurityMiddlewareOptions,
): MiddlewareHandler {
	const { token, trustedOrigins } = options;
	return async (c, next) => {
		// read-only 白名单：豁免 token 与来源检查。
		if (!requiresCapabilityToken(c.req.method, c.req.path)) {
			return next();
		}

		// 1. 辅助来源 deny：出现且非 null 且不可信 → 拒绝。
		//    （缺省 / null / 可信 → 放行进入 token 检查；token 才是首要依据）
		const origin = c.req.header("origin");
		const originAllowed =
			origin === undefined ||
			origin === NULL_ORIGIN ||
			trustedOrigins.has(origin);
		if (!originAllowed) {
			return jsonError(c, "FORBIDDEN_ORIGIN", "请求来源不是工作台可信来源");
		}

		// 2. 首要防线：capability token 必须匹配本次启动。
		const provided = c.req.header(CAPABILITY_TOKEN_HEADER);
		if (!provided || !tokenMatches(provided, token)) {
			return jsonError(
				c,
				"FORBIDDEN_LOCAL_API",
				"缺少或无效的本地 capability token",
			);
		}

		return next();
	};
}
