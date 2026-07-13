import { getActive } from "../src/agent.js";
import { createRuntimeApplication } from "../src/runtime-app.js";
import { startWorkbenchServer } from "../src/startup.js";
import type {
	PromptRouteService,
	PromptRunContext,
} from "../src/routes/prompt.js";

const FAKE_MODEL_MARKER = "browser-foundation-fake-model";
const selectedDirectory = process.env.LLM_WIKI_BROWSER_SELECTED_DIRECTORY;
if (!selectedDirectory) {
	throw new Error("browser test entry requires LLM_WIKI_BROWSER_SELECTED_DIRECTORY");
}

for (const key of [
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"PI_CONFIG_DIR",
	"XDG_CONFIG_HOME",
]) {
	if (process.env[key]) throw new Error(`browser test entry received forbidden environment: ${key}`);
}

const activeRuns = new Map<string, string>();
const promptService: PromptRouteService = {
	getRunSeed() {
		const active = getActive();
		if (!active) {
			throw Object.assign(new Error("没有活跃对话"), { code: "NO_ACTIVE_KB" });
		}
		return {
			active: {
				kbPath: active.kb.path,
				name: active.kb.name,
				conversationId: active.conversationId,
				sessionId: active.conversationId,
			},
			session: {
				subscribe: () => () => {},
				prompt: async () => {},
				state: {},
			},
		};
	},
	createRunId: () => `browser-run-${Date.now().toString(36)}`,
	createMessageId: (runId) => `assistant-${runId}`,
	beginRun(sessionId, runId) {
		if (activeRuns.has(sessionId)) return false;
		activeRuns.set(sessionId, runId);
		return true;
	},
	endRun(sessionId, runId) {
		if (activeRuns.get(sessionId) === runId) activeRuns.delete(sessionId);
	},
	subscribeSession: () => () => {},
	subscribeArtifacts: () => () => {},
	async runPrompt(ctx: PromptRunContext) {
		console.log(`[browser-test-model] ${FAKE_MODEL_MARKER}`);
		const delta = ctx.adapter.adapt({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "可控的测试回复",
				partial: {
					role: "assistant",
					content: [{ type: "text", text: "可控的测试回复" }],
				},
			},
		} as never)[0];
		if (delta) await ctx.writer.write(delta);
		for (const event of ctx.adapter.finishAssistant()) {
			await ctx.writer.write(event);
		}
	},
	abortSession: () => {},
	clearPendingKnowledgeContext: () => {},
};

const runningServer = await startWorkbenchServer({
	createApplication: (token) => createRuntimeApplication(token, {
		promptService,
		chooseDirectory: async () => selectedDirectory,
	}),
});

let shutdownPromise: Promise<void> | undefined;
function requestShutdown(): void {
	shutdownPromise ??= runningServer.close().then(() => {
		process.exitCode = 0;
	});
}

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);
