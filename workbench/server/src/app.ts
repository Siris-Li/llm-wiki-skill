import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { MiddlewareHandler } from "hono";

import { failure } from "@llm-wiki/workbench-contracts";

import { HttpContractError } from "./http/request.js";
import { createHealthRoutes } from "./routes/health.js";

export type WorkbenchAppMode = "test" | "dev" | "desktop";

/**
 * createApp 的依赖注入。route 测试传 fake deps，不读写真实
 * `~/.llm-wiki-agent/` 或知识库目录。
 */
export interface WorkbenchAppDeps {
	/**
	 * 运行模式。test 模式下 INTERNAL_ERROR 带脱敏 diagnostic id；
	 * dev/desktop 默认不带 details。
	 */
	mode?: WorkbenchAppMode;
	/**
	 * 可信来源 / capability token 统一检查接入点（#166 注入实现）。
	 * 会改文件、触发模型、改配置、启动 SSE 的端点都应在此校验；
	 * 生产实现内部负责把 health 等只读白名单端点豁免（见 spec §9）。
	 */
	security?: MiddlewareHandler;
}

/**
 * 组装工作台 Hono app：统一错误兜底 + 可信来源接入点 + 已迁移 route module。
 *
 * createApp 只做请求处理组装，不监听端口、不 bootstrap、不恢复 watcher、
 * 不读写真实用户目录。bootstrap / serve / watcher 都留在 index.ts。
 *
 * route 测试可直接 `createApp(deps).request('/api/health')`，无需启动端口。
 */
export function createApp(deps: WorkbenchAppDeps = {}): Hono {
	const app = new Hono();

	// 1. 统一错误兜底：
	//    - HttpContractError -> 失败 envelope（code/message/details），状态码由 code 决定。
	//    - 其它未捕获错误 -> INTERNAL_ERROR envelope（500），绝不泄露 stack / 路径 / key。
	app.onError((err, c) => {
		if (err instanceof HttpContractError) {
			return c.json(
				failure(err.code, err.message, err.details),
				err.httpStatus as ContentfulStatusCode,
			);
		}
		const details =
			deps.mode === "test"
				? { diagnosticId: redactedDiagnosticId() }
				: undefined;
		return c.json(failure("INTERNAL_ERROR", "服务器内部错误", details), 500);
	});

	// 2. 可信来源 / capability token 统一接入点（#166 实现；#165 预留）。
	//    注入 deps.security 后，所有 /api/* 请求先过它。
	if (deps.security) {
		app.use("/api/*", deps.security);
	}

	// 3. 已迁移 route module：统一经过 request / response / security 接入点。
	app.route("/api/health", createHealthRoutes());

	return app;
}

/**
 * 生成脱敏 diagnostic id：随机 token，不含错误 message / stack / 路径 / key。
 * 服务端日志据此 token 关联详细错误（日志关联在后续阶段实现）。
 */
function redactedDiagnosticId(): string {
	return randomUUID().slice(0, 8);
}
