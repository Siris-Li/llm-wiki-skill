/**
 * llm-wiki-agent 后端入口
 *
 * 阶段一 step 8 完整端点：
 *   GET    /api/health                          心跳
 *   POST   /api/prompt                          发消息（SSE 回 agent 事件流）
 *
 *   GET    /api/knowledge-bases                 列出所有已知知识库
 *   POST   /api/knowledge-bases/external        登记外部库
 *   DELETE /api/knowledge-bases/external        取消登记
 *
 *   GET    /api/knowledge-base                  当前活跃上下文（含 kb + conversation + messages）
 *   POST   /api/knowledge-base                  选择 KB（自动加载/新建对话）
 *   DELETE /api/knowledge-base                  清空活跃上下文
 *
 *   GET    /api/conversations?kb=<path>         列出某 KB 下所有对话
 *   POST   /api/conversations                   切到指定对话 body: {kbPath, conversationId}
 *   POST   /api/conversations/new               在指定 KB 新建对话 body: {kbPath}
 */

import { createRuntimeApplication } from "./runtime-app.js";
import { startWorkbenchServer } from "./startup.js";

const runningServer = await startWorkbenchServer({
	createApplication: createRuntimeApplication,
});

console.log(`  GET    /api/health`);
console.log(`  POST   /api/prompt`);
console.log(`  GET    /api/knowledge-bases`);
console.log(`  POST   /api/knowledge-bases/external`);
console.log(`  DELETE /api/knowledge-bases/external`);
console.log(`  GET    /api/knowledge-base`);
console.log(`  POST   /api/knowledge-base`);
console.log(`  DELETE /api/knowledge-base`);
console.log(`  GET    /api/conversations?kb=<path>`);
console.log(`  POST   /api/conversations`);
console.log(`  POST   /api/conversations/new`);
console.log(`  GET    /api/artifacts?conversation=<id>`);
console.log(`  GET    /api/artifacts/:id`);
console.log(`  GET    /api/artifacts/:id/files/:filename`);
console.log(`  GET    /api/config`);
console.log(`  POST   /api/config`);

let shutdownPromise: Promise<void> | undefined;
function requestShutdown(signal: NodeJS.Signals): void {
	shutdownPromise ??= runningServer.close().then(
		() => {
			console.log(`[llm-wiki-agent/server] stopped after ${signal}`);
			process.exitCode = 0;
		},
		(error) => {
			console.error(`[llm-wiki-agent/server] shutdown failed`, error);
			process.exitCode = 1;
		},
	);
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));
