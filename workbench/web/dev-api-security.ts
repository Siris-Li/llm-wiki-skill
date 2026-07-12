import type { IncomingMessage, ServerResponse } from "node:http";

import {
	errorCodeToHttpStatus,
	failure,
	findEndpoint,
	hasTrustedBrowserSource,
	isExplicitlyUntrustedSource,
	requiresCapabilityToken,
} from "@llm-wiki/workbench-contracts";

type Next = (error?: unknown) => void;

function requestPath(request: IncomingMessage): string {
	return new URL(request.url ?? "/", "http://localhost").pathname;
}

function isPublicRequest(request: IncomingMessage): boolean {
	return findEndpoint(request.method ?? "GET", requestPath(request))?.safety === "public";
}

function isTrustedWorkbenchRequest(
	request: IncomingMessage,
	trustedOrigins: ReadonlySet<string>,
): boolean {
	const origin = request.headers.origin;
	const fetchSite = request.headers["sec-fetch-site"] as string | undefined;
	const signals = { origin, fetchSite };
	return (
		!isExplicitlyUntrustedSource(signals, trustedOrigins) &&
		hasTrustedBrowserSource(signals, trustedOrigins)
	);
}

function deny(response: ServerResponse): void {
	response.statusCode = errorCodeToHttpStatus.FORBIDDEN_ORIGIN;
	response.setHeader("Content-Type", "application/json; charset=utf-8");
	response.end(
		JSON.stringify(
			failure("FORBIDDEN_ORIGIN", "请求来源不是工作台可信来源"),
		),
	);
}

/** Vite 代理的前置门：只让公开探活或可信工作台请求进入代理。 */
export function createDevApiRequestGuard(
	trustedOrigins: ReadonlySet<string>,
): (request: IncomingMessage, response: ServerResponse, next: Next) => void {
	return (request, response, next) => {
		if (isPublicRequest(request) || isTrustedWorkbenchRequest(request, trustedOrigins)) {
			next();
			return;
		}
		deny(response);
	};
}

/** 所有读取本地内容或改变状态的已放行请求都由开发代理代带启动凭证。 */
export function shouldInjectCapabilityToken(request: IncomingMessage): boolean {
	return requiresCapabilityToken(request.method ?? "GET", requestPath(request));
}
