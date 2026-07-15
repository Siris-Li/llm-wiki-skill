import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
	CAPABILITY_TOKEN_HEADER,
	DEV_WORKBENCH_ORIGINS,
} from "@llm-wiki/workbench-contracts";

import {
	assertLoopbackDevServerHost,
	createDevApiRequestGuard,
	shouldInjectCapabilityToken,
} from "./dev-api-security";

const apiOrigin = process.env.LLM_WIKI_AGENT_API_ORIGIN || "http://localhost:8787";
const disableHmr = process.env.LLM_WIKI_AGENT_DISABLE_HMR === "1";
const trustedOrigins = new Set(DEV_WORKBENCH_ORIGINS);

// ============= 本地 capability token（#166） =============
//
// dev 期由 Vite 代理把后端生成的 capability token 注入到转发请求头，这样：
//   - token 永远不进入浏览器上下文（抗 XSS：前端业务代码、JS 都拿不到它）；
//   - 前端 API 请求继续通过 /api 代理；普通 JSON 请求通过统一 API client；
//   - token 不进 URL / 不进日志 / 不进仓库 / 不进 config（只存在后端内存 + 这份
//     运行期文件里，由同机可信的 dev 代理读取后注入）。
//
// 路径与后端 workbench/server/src/security/token.ts 的 CAPABILITY_TOKEN_FILE 对齐
// （~/.llm-wiki-agent/runtime/capability-token）；请求头名取自 @llm-wiki/workbench-contracts
// 单一来源（与后端中间件共享同一常量，避免双端漂移）。
const CAPABILITY_TOKEN_FILE = resolve(
	homedir(),
	".llm-wiki-agent",
	"runtime",
	"capability-token",
);

// 同步缓存：proxyReq 回调必须同步注入 header（异步 setHeader 会晚于请求发出）。
// 按 mtime 失效重读，自动适配 tsx watch 重启后端换发的新 token。后端尚未写文件时
// 返回 undefined（本次不注入），下一笔请求后端起来后自动补上。
let cachedToken: string | undefined;
let cachedMtimeMs: number | undefined;
function readCapabilityTokenSync(): string | undefined {
	try {
		const mtimeMs = statSync(CAPABILITY_TOKEN_FILE).mtimeMs;
		if (mtimeMs === cachedMtimeMs) return cachedToken;
		cachedToken = readFileSync(CAPABILITY_TOKEN_FILE, "utf8").trim();
		cachedMtimeMs = mtimeMs;
		return cachedToken;
	} catch {
		return undefined;
	}
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		{
			name: "llm-wiki-dev-api-security",
			configResolved(config) {
				assertLoopbackDevServerHost(config.server.host);
			},
			configureServer(server) {
				const guard = createDevApiRequestGuard(trustedOrigins);
				server.middlewares.use((request, response, next) => {
					if (!request.url?.startsWith("/api")) return next();
					guard(request, response, next);
				});
			},
		},
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": resolve(import.meta.dirname, "./src"),
		},
	},
	server: {
		// 用 5180 避开 Vite 默认 5173（其他项目可能占用）；strictPort 让冲突时直接报错，避免静默漂移
		host: "127.0.0.1",
		port: 5180,
		strictPort: true,
		hmr: disableHmr ? false : undefined,
		proxy: {
			// dev 期同源访问后端，避免 CORS；生产由后端/Tauri 直接服务前端
			"/api": {
				target: apiOrigin,
				changeOrigin: true,
				configure: (proxy) => {
					// 为已通过来源检查且访问本地内容的请求注入 capability token。
					proxy.on("proxyReq", (proxyReq, request) => {
						if (!shouldInjectCapabilityToken(request)) return;
						const token = readCapabilityTokenSync();
						if (token) proxyReq.setHeader(CAPABILITY_TOKEN_HEADER, token);
					});
				},
			},
		},
	},
});
