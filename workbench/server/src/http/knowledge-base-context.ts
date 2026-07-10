import {
	KnowledgeBaseContextBodySchema,
	KnowledgeBaseContextQuerySchema,
} from "@llm-wiki/workbench-contracts";

import { HttpContractError } from "./request.js";

export interface KnowledgeBaseContextRequest {
	queryKb?: string;
	body?: unknown;
}

export interface KnowledgeBaseContextResolverDeps {
	getActiveKnowledgeBasePath: () => string | null;
	assertRegisteredKnowledgeBase: (kbPath: string) => Promise<string>;
}

/**
 * 知识库上下文唯一解析入口：GET query 用 `kb`，JSON body 用 `kbPath`，显式输入
 * 优先于 active context；显式或 active 路径都必须通过同一个登记校验。
 */
export async function resolveKnowledgeBaseContext(
	request: KnowledgeBaseContextRequest,
	deps: KnowledgeBaseContextResolverDeps,
): Promise<string> {
	const parsedQuery = KnowledgeBaseContextQuerySchema.safeParse({
		...(request.queryKb === undefined ? {} : { kb: request.queryKb }),
	});
	if (!parsedQuery.success) {
		throw invalidContextRequest(parsedQuery.error.issues);
	}

	let bodyKbPath: string | undefined;
	if (request.body !== undefined) {
		const parsedBody = KnowledgeBaseContextBodySchema.safeParse(request.body);
		if (!parsedBody.success) {
			throw invalidContextRequest(parsedBody.error.issues);
		}
		bodyKbPath = parsedBody.data.kbPath;
	}

	const requestedPath = parsedQuery.data.kb ?? bodyKbPath;
	const kbPath = requestedPath ?? deps.getActiveKnowledgeBasePath();
	if (!kbPath) {
		throw new HttpContractError("NO_ACTIVE_KB", "当前没有选择知识库");
	}

	try {
		return await deps.assertRegisteredKnowledgeBase(kbPath);
	} catch (err) {
		throw mapKnowledgeBaseError(err);
	}
}

export function mapKnowledgeBaseError(err: unknown): HttpContractError {
	if (err instanceof HttpContractError) {
		if (err.code === "NO_ACTIVE_KB") {
			return new HttpContractError("NO_ACTIVE_KB", "当前没有选择知识库");
		}
		if (err.code === "KB_NOT_REGISTERED") {
			return new HttpContractError(
				"KB_NOT_REGISTERED",
				"知识库未登记或已失效",
			);
		}
		if (err.code === "FORBIDDEN_PATH") {
			return new HttpContractError(
				"FORBIDDEN_PATH",
				"路径不在允许的知识库边界内",
				{ reason: forbiddenPathReason(err.details) },
			);
		}
		return err;
	}
	const source = err as {
		code?: unknown;
		statusCode?: unknown;
		details?: unknown;
	};
	if (source.code === "NO_ACTIVE_KB") {
		return new HttpContractError("NO_ACTIVE_KB", "当前没有选择知识库");
	}
	if (source.code === "KB_NOT_REGISTERED") {
		return new HttpContractError(
			"KB_NOT_REGISTERED",
			"知识库未登记或已失效",
		);
	}
	if (source.code === "FORBIDDEN_PATH" || source.statusCode === 403) {
		const reason = forbiddenPathReason(source.details);
		return new HttpContractError(
			"FORBIDDEN_PATH",
			"路径不在允许的知识库边界内",
			{ reason },
		);
	}
	return new HttpContractError("INTERNAL_ERROR", "服务器内部错误");
}

function forbiddenPathReason(
	details: unknown,
): "outside-root" | "not-registered" | "symlink-escape" {
	if (details && typeof details === "object") {
		const reason = (details as { reason?: unknown }).reason;
		if (
			reason === "outside-root" ||
			reason === "not-registered" ||
			reason === "symlink-escape"
		) {
			return reason;
		}
	}
	return "outside-root";
}

function invalidContextRequest(
	issues: Array<{ path: PropertyKey[]; message: string }>,
): HttpContractError {
	return new HttpContractError("INVALID_REQUEST", "请求字段不符合 schema", {
		issues: issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		})),
	});
}
