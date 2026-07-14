import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DEV_WORKBENCH_ORIGINS } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import { listLoadedSkills } from "./agent.js";
import { loadConfig } from "./config.js";
import { createSecurityMiddleware } from "./security/middleware.js";
import type { PromptRouteService } from "./routes/prompt.js";
import { createWiki, InitConflictError, initExistingWiki } from "./wiki-init.js";

const execFileAsync = promisify(execFile);

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
	});
	configureLegacyRoutes(app, options);
	return app;
}

function configureLegacyRoutes(
	app: ReturnType<typeof createApp>,
	options: RuntimeApplicationOptions,
): void {
	app.post("/api/echo", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: "Invalid JSON body" }, 400);
		}
		return c.json({ ok: true, received: body });
	});

	// ============= 知识库初始化（仍为 legacy；列表/登记/active context 已迁入 routes） =============

	app.post("/api/knowledge-bases/new", async (c) => {
		let body: { name?: unknown; purpose?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: "Invalid JSON body" }, 400);
		}
		if (typeof body.name !== "string" || typeof body.purpose !== "string") {
			return c.json({ ok: false, error: "Missing 'name' or 'purpose'" }, 400);
		}
		try {
			const result = await createWiki(body.name, body.purpose);
			return c.json({
				ok: true,
				info: {
					path: result.path,
					name: result.name,
					origin: "default",
					valid: true,
				},
				stdout: result.stdout,
				stderr: result.stderr,
			});
		} catch (err) {
			return c.json(
				{ ok: false, error: err instanceof Error ? err.message : String(err) },
				400,
			);
		}
	});

	app.post("/api/knowledge-bases/init-existing", async (c) => {
		let body: { path?: unknown; purpose?: unknown; overwrite?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: "Invalid JSON body" }, 400);
		}
		if (typeof body.path !== "string" || typeof body.purpose !== "string") {
			return c.json({ ok: false, error: "Missing 'path' or 'purpose'" }, 400);
		}
		try {
			const result = await initExistingWiki(body.path, body.purpose, body.overwrite === true);
			return c.json({
				ok: true,
				info: {
					path: result.path,
					name: result.path.split("/").filter(Boolean).pop() ?? result.path,
					origin: "external",
					valid: true,
				},
				stdout: result.stdout,
				stderr: result.stderr,
				backedUpFiles: result.backedUpFiles,
			});
		} catch (err) {
			if (err instanceof InitConflictError) {
				return c.json({ ok: false, error: err.message, conflicts: err.conflicts }, 409);
			}
			return c.json(
				{ ok: false, error: err instanceof Error ? err.message : String(err) },
				400,
			);
		}
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

	app.post("/api/system/choose-directory", async (c) => {
		try {
			const selectedPath = await (options.chooseDirectory ?? chooseSystemDirectory)();
			if (!selectedPath) return c.json({ ok: false, canceled: true });
			return c.json({ ok: true, path: selectedPath });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if ((err as NodeJS.ErrnoException).code === "ENOTSUP") {
				return c.json({ ok: false, error: message }, 501);
			}
			if ((err as NodeJS.ErrnoException).code === "EMPTY_SELECTION") {
				return c.json({ ok: false, error: message }, 400);
			}
			if (message.includes("-128") || message.toLowerCase().includes("user canceled")) {
				return c.json({ ok: false, canceled: true });
			}
			return c.json({ ok: false, error: message }, 500);
		}
	});

}

async function chooseSystemDirectory(): Promise<string | null> {
	if (process.platform !== "darwin") {
		throw Object.assign(new Error("当前系统暂不支持文件夹选择器"), {
			code: "ENOTSUP",
		});
	}
	const { stdout } = await execFileAsync("osascript", [
		"-e",
		'POSIX path of (choose folder with prompt "选择知识库文件夹")',
	]);
	const selectedPath = stdout.trim();
	if (!selectedPath) {
		throw Object.assign(new Error("没有选择文件夹"), {
			code: "EMPTY_SELECTION",
		});
	}
	return selectedPath;
}
