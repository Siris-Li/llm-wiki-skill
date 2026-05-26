/**
 * agent.ts - pi-coding-agent SDK 的会话管理
 *
 * 阶段一 step 4：单 in-memory session。
 * 阶段一 step 5：用 DefaultResourceLoader 注入我们自己的 Extension
 *   - 通过 extensionFactories 注册"当前知识库"工具
 *   - 同时仍会自动加载用户 ~/.pi/agent/extensions/ 和 ~/.pi/agent/skills/
 *
 * 凭证与模型：完全依赖 pi-agent 默认行为
 *   - AuthStorage 自动读 ~/.pi/agent/auth.json
 *   - 模型从 ~/.pi/agent/settings.json 读默认值
 */

import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import knowledgeBaseExtension from "./extensions/knowledge-base.js";

let resourceLoaderPromise: Promise<DefaultResourceLoader> | null = null;
let sessionPromise: Promise<AgentSession> | null = null;

function getResourceLoader(): Promise<DefaultResourceLoader> {
	if (!resourceLoaderPromise) {
		resourceLoaderPromise = (async () => {
			const loader = new DefaultResourceLoader({
				cwd: process.cwd(),
				agentDir: getAgentDir(),
				extensionFactories: [knowledgeBaseExtension],
			});
			await loader.reload();
			console.log("[agent] ResourceLoader ready, extensions/skills discovered");
			return loader;
		})().catch((err) => {
			resourceLoaderPromise = null;
			throw err;
		});
	}
	return resourceLoaderPromise;
}

/**
 * 获取（或惰性创建）单一 agent session。
 */
export function getSession(): Promise<AgentSession> {
	if (!sessionPromise) {
		sessionPromise = (async () => {
			const loader = await getResourceLoader();
			const { session, modelFallbackMessage } = await createAgentSession({
				resourceLoader: loader,
				sessionManager: SessionManager.inMemory(),
			});
			if (modelFallbackMessage) {
				console.log(`[agent] ${modelFallbackMessage}`);
			}
			console.log(`[agent] session created: ${session.sessionId}`);
			return session;
		})().catch((err) => {
			sessionPromise = null;
			throw err;
		});
	}
	return sessionPromise;
}

/**
 * 重置 session（用户主动开新对话时调）。
 */
export async function resetSession(): Promise<void> {
	if (sessionPromise) {
		try {
			const session = await sessionPromise;
			session.dispose();
		} catch {
			// 创建失败时无 session 可释放
		}
	}
	sessionPromise = null;
}
