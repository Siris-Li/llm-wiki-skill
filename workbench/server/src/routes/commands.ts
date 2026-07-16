import { Hono } from "hono";
import {
	AppConfigSchema,
	CommandListDataSchema,
	CommandListQuerySchema,
	type AppConfig,
} from "@llm-wiki/workbench-contracts";

import { listLoadedSkills, type LoadedSkillInfo as AgentLoadedSkillInfo } from "../agent.js";
import { loadConfig } from "../config.js";
import { HttpContractError, parseValidatedInput } from "../http/request.js";
import { jsonOk } from "../http/response.js";

type CommandSkill = Pick<AgentLoadedSkillInfo, "name" | "description" | "source" | "skillPath">;

export interface CommandRouteService {
	loadConfig: () => Promise<AppConfig>;
	listLoadedSkills: () => Promise<readonly CommandSkill[]>;
}

export const defaultCommandRouteService: CommandRouteService = {
	loadConfig: async () => AppConfigSchema.parse(await loadConfig()),
	listLoadedSkills,
};

const builtinCommands = [
	{
		slug: "/sediment",
		name: "sediment_to_wiki",
		description: "把当前对话结晶为 wiki/synthesis/sessions/ 下的页面",
		source: "builtin",
		isProjectSkill: false,
	},
	{
		slug: "/new-wiki",
		name: "new_wiki",
		description: "在默认目录下新建一个 llm-wiki 知识库",
		source: "builtin",
		isProjectSkill: false,
	},
	{
		slug: "/html",
		name: "html",
		description: "把当前对话导出为自包含 HTML 页面",
		source: "builtin",
		isProjectSkill: false,
	},
] as const;

export function createCommandRoutes(service: CommandRouteService): Hono {
	const router = new Hono();

	router.get("/", async (c) => {
		const query = parseValidatedInput(
			CommandListQuerySchema,
			queryParamsForValidation(new URL(c.req.url).searchParams),
		);
		const includeUserGlobal =
			query.includeUserGlobal === "true" ||
			(query.includeUserGlobal === undefined && (await service.loadConfig()).showUserGlobalSkills === true);
		const skills = await service.listLoadedSkills();
		const commands = [
			...builtinCommands,
			...skills
				.filter((skill) => includeUserGlobal || skill.source !== "user-global")
				.map((skill) => ({
					slug: `/${skill.name}`,
					name: skill.name,
					description: skill.description,
					source: skill.source,
					isProjectSkill: skill.source === "builtin",
				})),
		];
		return jsonOk(c, CommandListDataSchema.parse(commands));
	});

	return router;
}

function queryParamsForValidation(
	searchParams: URLSearchParams,
): Record<string, string | string[]> {
	const query = Object.create(null) as Record<string, string | string[]>;
	for (const key of new Set(searchParams.keys())) {
		// Zod deliberately drops this key to avoid prototype pollution, but a
		// strict query contract must still reject every unrecognized input.
		if (key === "__proto__") {
			throw new HttpContractError("INVALID_REQUEST", "请求字段不符合 schema", {
				issues: [{ path: key, message: "Unrecognized key: \"__proto__\"" }],
			});
		}
		const values = searchParams.getAll(key);
		query[key] = values.length === 1 ? values[0] ?? "" : values;
	}
	return query;
}
