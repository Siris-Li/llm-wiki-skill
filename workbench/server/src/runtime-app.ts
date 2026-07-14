import { DEV_WORKBENCH_ORIGINS } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import { listLoadedSkills } from "./agent.js";
import { loadConfig } from "./config.js";
import { createSecurityMiddleware } from "./security/middleware.js";
import type { PromptRouteService } from "./routes/prompt.js";
import { defaultKnowledgeBaseRouteService } from "./routes/knowledge-bases.js";

const trustedOrigins = new Set(DEV_WORKBENCH_ORIGINS);

export interface RuntimeApplicationOptions {
	promptService?: PromptRouteService;
	chooseDirectory?: () => Promise<string | null>;
}

/** Build the exact application served by the runtime without opening a port. */
export function createRuntimeApplication(
	capabilityToken: string,
	options: RuntimeApplicationOptions = {},
) {
	const app = createApp({
		security: createSecurityMiddleware({
			token: capabilityToken,
			trustedOrigins,
		}),
		...(options.promptService ? { promptService: options.promptService } : {}),
		...(options.chooseDirectory
			? {
				knowledgeBaseService: {
					...defaultKnowledgeBaseRouteService,
					chooseDirectory: options.chooseDirectory,
				},
			}
			: {}),
	});
	configureLegacyRoutes(app);
	return app;
}

function configureLegacyRoutes(app: ReturnType<typeof createApp>): void {
	app.post("/api/echo", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: "Invalid JSON body" }, 400);
		}
		return c.json({ ok: true, received: body });
	});

	// ============= Slash 命令列表 =============

	app.get("/api/commands", async (c) => {
		try {
			const queryValue = c.req.query("includeUserGlobal");
			const includeUserGlobal =
				queryValue === "true" ||
				(queryValue === undefined && (await loadConfig()).showUserGlobalSkills === true);
			const builtin = [
				{
					slug: "/sediment",
					name: "sediment_to_wiki",
					description: "把当前对话结晶为 wiki/synthesis/sessions/ 下的页面",
					source: "builtin",
					skillPath: null,
				},
				{
					slug: "/new-wiki",
					name: "new_wiki",
					description: "在默认目录下新建一个 llm-wiki 知识库",
					source: "builtin",
					skillPath: null,
				},
				{
					slug: "/html",
					name: "html",
					description: "把当前对话导出为自包含 HTML 页面",
					source: "builtin",
					skillPath: null,
				},
			];
			const skills = (await listLoadedSkills())
				.filter((skill) => includeUserGlobal || skill.source !== "user-global")
				.map((skill) => ({
					slug: `/${skill.name}`,
					name: skill.name,
					description: skill.description,
					source: skill.source,
					skillPath: skill.skillPath,
				}));
			return c.json({ ok: true, items: [...builtin, ...skills] });
		} catch (err) {
			return c.json(
				{ ok: false, error: err instanceof Error ? err.message : String(err) },
				500,
			);
		}
	});

}
