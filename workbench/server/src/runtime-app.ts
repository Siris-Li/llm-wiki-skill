import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DEV_WORKBENCH_ORIGINS } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import { listLoadedSkills } from "./agent.js";
import { setAuthKey, testAuthConnection } from "./auth.js";
import { loadConfig } from "./config.js";
import { createSecurityMiddleware } from "./security/middleware.js";
import { createWiki, InitConflictError, initExistingWiki } from "./wiki-init.js";

const execFileAsync = promisify(execFile);

const trustedOrigins = new Set(DEV_WORKBENCH_ORIGINS);

/** Build the exact application served by the runtime without opening a port. */
export function createRuntimeApplication(capabilityToken: string) {
	const app = createApp({
		security: createSecurityMiddleware({
			token: capabilityToken,
			trustedOrigins,
		}),
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
		if (process.platform !== "darwin") {
			return c.json({ ok: false, error: "当前系统暂不支持文件夹选择器" }, 501);
		}
		try {
			const { stdout } = await execFileAsync("osascript", [
				"-e",
				'POSIX path of (choose folder with prompt "选择知识库文件夹")',
			]);
			const selectedPath = stdout.trim();
			if (!selectedPath) return c.json({ ok: false, error: "没有选择文件夹" }, 400);
			return c.json({ ok: true, path: selectedPath });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes("-128") || message.toLowerCase().includes("user canceled")) {
				return c.json({ ok: false, canceled: true });
			}
			return c.json({ ok: false, error: message }, 500);
		}
	});

	// ============= 模型认证 =============

	app.post("/api/auth/set", async (c) => {
		let body: { provider?: unknown; type?: unknown; key?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: "Invalid JSON body" }, 400);
		}
		if (body.type !== "api_key" || typeof body.provider !== "string" || typeof body.key !== "string") {
			return c.json({ ok: false, error: "Missing provider/type/key" }, 400);
		}
		try {
			await setAuthKey(body.provider, body.key);
			return c.json({ ok: true });
		} catch (err) {
			return c.json(
				{ ok: false, error: err instanceof Error ? err.message : String(err) },
				400,
			);
		}
	});

	app.post("/api/auth/test", async (c) => {
		let body: { provider?: unknown };
		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: "Invalid JSON body" }, 400);
		}
		if (typeof body.provider !== "string") {
			return c.json({ ok: false, error: "Missing provider" }, 400);
		}
		const result = await testAuthConnection(body.provider);
		return c.json(result);
	});
}
