/**
 * agent.ts - pi-coding-agent SDK 的会话管理
 *
 * 阶段一 step 4：单个 in-memory session，所有 /api/prompt 请求共享。
 * 后续阶段会改成：按知识库绑定 session、用 SessionManager.create(...) 持久化、
 * 通过 Extension 注入 currentKnowledgeBase 上下文。
 *
 * 凭证与模型：完全依赖 pi-agent 默认行为
 *   - AuthStorage 自动读 ~/.pi/agent/auth.json
 *   - 模型从 ~/.pi/agent/settings.json 读默认值
 *   - 用户在 CLI 里 `pi login` 一次即可
 */

import {
	type AgentSession,
	createAgentSession,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

let sessionPromise: Promise<AgentSession> | null = null;

/**
 * 获取（或惰性创建）单一 agent session。
 * 并发请求会共享同一个 promise，避免重复初始化。
 * 创建失败会清空缓存，下次调用可重试。
 */
export function getSession(): Promise<AgentSession> {
	if (!sessionPromise) {
		sessionPromise = createAgentSession({
			sessionManager: SessionManager.inMemory(),
		})
			.then(({ session, modelFallbackMessage }) => {
				if (modelFallbackMessage) {
					console.log(`[agent] ${modelFallbackMessage}`);
				}
				console.log(`[agent] session created: ${session.sessionId}`);
				return session;
			})
			.catch((err) => {
				sessionPromise = null;
				throw err;
			});
	}
	return sessionPromise;
}

/**
 * 重置 session（用户主动开新对话时调）。
 * 老 session 通过 dispose 释放资源。
 */
export async function resetSession(): Promise<void> {
	if (sessionPromise) {
		try {
			const session = await sessionPromise;
			session.dispose();
		} catch {
			// 若初始化曾失败，dispose 也无需关注
		}
	}
	sessionPromise = null;
}
