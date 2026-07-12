import { Hono } from "hono";
import type { HealthData } from "@llm-wiki/workbench-contracts";

import { jsonOk } from "../http/response.js";

/**
 * GET /api/health —— 只读心跳端点。
 *
 * 无副作用：不读写文件、不触发模型、不改配置、不发起 SSE。因此在本地 API
 * 信任边界里属于公开探活入口（见 spec §9），#166 的来源和 token 检查应豁免它。
 */
export function createHealthRoutes(): Hono {
	const router = new Hono();
	router.get("/", (c) => {
		const data: HealthData = {
			status: "ok",
			timestamp: Date.now(),
			service: "llm-wiki-agent/server",
		};
		return jsonOk(c, data);
	});
	return router;
}
