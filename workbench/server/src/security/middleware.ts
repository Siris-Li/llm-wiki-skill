import { timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import {
	hasTrustedBrowserSource,
	isExplicitlyUntrustedSource,
	requiresCapabilityToken,
	requiresTrustedSource,
} from "@llm-wiki/workbench-contracts";

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
	 * 注意：即便 origin 在白名单内，访问本地内容的 endpoint 仍要求 token —— origin
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
 *  - public endpoint（仅 health）→ 不读取本地内容，豁免来源与 token。
 *  - read-only endpoint → 必须同时通过可信工作台来源与本次启动 token。
 *  - state-changing endpoint（含未登记，fail closed）→ 必须同时满足可信来源和
 *    本次启动 token。
 *
 * 设计要点（spec §9 / #9 / #10）：
 *  - token 是无 Origin 客户端的身份依据；浏览器来源还要通过 Origin / Fetch Metadata。
 *  - null origin 不能单独放行：仍必须带 token（走第 2 步）。
 *  - 未登记 endpoint 默认要求 token，避免新增状态改写路由漏过检查。
 *  - 失败一律走统一 error envelope + 稳定 code（spec §9）。
 */
export function createSecurityMiddleware(
	options: SecurityMiddlewareOptions,
): MiddlewareHandler {
	const { token, trustedOrigins } = options;
	return async (c, next) => {
		const tokenRequired = requiresCapabilityToken(c.req.method, c.req.path);
		const sourceRequired = requiresTrustedSource(c.req.method, c.req.path);
		if (!sourceRequired) {
			return next();
		}

		const origin = c.req.header("origin");
		const fetchSite = c.req.header("sec-fetch-site");
		const provided = c.req.header(CAPABILITY_TOKEN_HEADER);
		const validToken = provided ? tokenMatches(provided, token) : false;
		const sourceSignals = { origin, fetchSite };
		const explicitlyUntrusted = isExplicitlyUntrustedSource(
			sourceSignals,
			trustedOrigins,
		);
		if (explicitlyUntrusted) {
			return jsonError(c, "FORBIDDEN_ORIGIN", "请求来源不是工作台可信来源");
		}

		if (tokenRequired && !validToken) {
			return jsonError(
				c,
				"FORBIDDEN_LOCAL_API",
				"缺少或无效的本地 capability token",
			);
		}

		const trustedSource =
			hasTrustedBrowserSource(sourceSignals, trustedOrigins) ||
			((origin === undefined || origin === NULL_ORIGIN) && validToken);
		if (!trustedSource) {
			return jsonError(c, "FORBIDDEN_ORIGIN", "请求来源不是工作台可信来源");
		}

		return next();
	};
}
