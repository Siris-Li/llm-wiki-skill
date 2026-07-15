import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITY_TOKEN_HEADER } from "@llm-wiki/workbench-contracts";

import { createApp } from "../app.js";
import { createRuntimeApplication } from "../runtime-app.js";

const exampleProjectSkillPath = "/Users/example/.llm-wiki-agent/skills/project-skill";
const exampleGlobalSkillPath = "/Users/example/.claude/skills/user-global";

test("GET /api/commands returns the unified command data without local skill paths", async () => {
	const app = createApp({
		commandService: {
			loadConfig: async () => ({
				version: 1,
				externalKnowledgeBases: [],
				showUserGlobalSkills: false,
			}),
			listLoadedSkills: async () => [
				{
					name: "project-skill",
					description: "Project capability",
					source: "builtin" as const,
					skillPath: exampleProjectSkillPath,
				},
				{
					name: "pi-help",
					description: "Pi capability",
					source: "pi-default" as const,
					skillPath: "/opt/pi/default-skills/pi-help",
				},
				{
					name: "private-global",
					description: "User capability",
					source: "user-global" as const,
					skillPath: exampleGlobalSkillPath,
				},
			],
		},
	});

	const response = await app.request("/api/commands");
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		ok: true,
		data: [
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
			{
				slug: "/project-skill",
				name: "project-skill",
				description: "Project capability",
				source: "builtin",
				isProjectSkill: true,
			},
			{
				slug: "/pi-help",
				name: "pi-help",
				description: "Pi capability",
				source: "pi-default",
				isProjectSkill: false,
			},
		],
	});
});

test("GET /api/commands only includes user-global skills when requested", async () => {
	const app = createApp({
		commandService: {
			loadConfig: async () => ({ version: 1, externalKnowledgeBases: [] }),
			listLoadedSkills: async () => [
				{
					name: "user-global",
					description: "User capability",
					source: "user-global" as const,
					skillPath: exampleGlobalSkillPath,
				},
			],
		},
	});

	const response = await app.request("/api/commands?includeUserGlobal=true");
	assert.equal(response.status, 200);
	const payload = await response.json() as { ok: boolean; data: Array<Record<string, unknown>> };
	assert.deepEqual(payload.data.at(-1), {
		slug: "/user-global",
		name: "user-global",
		description: "User capability",
		source: "user-global",
		isProjectSkill: false,
	});
	assert.equal(JSON.stringify(payload).includes(exampleGlobalSkillPath), false);
});

test("GET /api/commands follows the saved global-skill preference unless explicitly disabled", async () => {
	const app = createApp({
		commandService: {
			loadConfig: async () => ({
				version: 1,
				externalKnowledgeBases: [],
				showUserGlobalSkills: true,
			}),
			listLoadedSkills: async () => [{
				name: "user-global",
				description: "User capability",
				source: "user-global" as const,
				skillPath: exampleGlobalSkillPath,
			}],
		},
	});

	const defaultResponse = await app.request("/api/commands");
	const explicitFalseResponse = await app.request("/api/commands?includeUserGlobal=false");
	const defaultPayload = await defaultResponse.json() as { data: Array<{ slug: string }> };
	const explicitFalsePayload = await explicitFalseResponse.json() as { data: Array<{ slug: string }> };
	assert.equal(defaultResponse.status, 200);
	assert.equal(explicitFalseResponse.status, 200);
	assert.equal(defaultPayload.data.some((item) => item.slug === "/user-global"), true);
	assert.equal(explicitFalsePayload.data.some((item) => item.slug === "/user-global"), false);
});

test("GET /api/commands rejects invalid query values through the unified error envelope", async () => {
	const app = createApp({ mode: "test" });

	for (const path of [
		"/api/commands?includeUserGlobal=unexpected",
		"/api/commands?unexpected=true",
		"/api/commands?includeUserGlobal=true&includeUserGlobal=false",
		"/api/commands?__proto__=true",
		"/api/commands?includeUserGlobal=true&__proto__=false",
	]) {
		const response = await app.request(path);
		const payload = await response.json() as {
			ok: boolean;
			code: string;
			message: string;
		};
		assert.equal(response.status, 400, path);
		assert.equal(payload.ok, false, path);
		assert.equal(payload.code, "INVALID_REQUEST", path);
		assert.equal(payload.message, "请求字段不符合 schema", path);
	}
});

test("GET /api/commands hides internal failures and local details", async () => {
	const app = createApp({
		commandService: {
			loadConfig: async () => ({ version: 1, externalKnowledgeBases: [] }),
			listLoadedSkills: async () => {
				throw new Error(`${exampleGlobalSkillPath} failed with sk-command-should-not-leak`);
			},
		},
		mode: "test",
	});

	const response = await app.request("/api/commands");
	assert.equal(response.status, 500);
	const payload = await response.json() as {
		ok: boolean;
		code: string;
		message: string;
		details?: { diagnosticId?: string };
	};
	assert.equal(payload.ok, false);
	assert.equal(payload.code, "INTERNAL_ERROR");
	assert.equal(payload.message, "服务器内部错误");
	assert.equal(typeof payload.details?.diagnosticId, "string");
	assert.equal(JSON.stringify(payload).includes(exampleGlobalSkillPath), false);
	assert.equal(JSON.stringify(payload).includes("sk-command-should-not-leak"), false);
});

test("POST /api/echo no longer has a runtime handler", async () => {
	const token = "commands-runtime-test-token";
	const app = createRuntimeApplication(token);

	const response = await app.request("/api/echo", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost:5180",
			[CAPABILITY_TOKEN_HEADER]: token,
		},
		body: JSON.stringify({ diagnostic: "removed" }),
	});

	assert.equal(response.status, 404);
});
