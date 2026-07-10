import { Hono } from "hono";
import {
	AppConfigSchema,
	AvailableModelsDataSchema,
	ConfigPatchSchema,
	ModelRefSchema,
	type AppConfig,
	type ConfigPatch,
} from "@llm-wiki/workbench-contracts";

import { listAvailableModels, reloadActiveResources } from "../agent.js";
import { loadConfig, saveConfig } from "../config.js";
import { parseValidatedBody } from "../http/request.js";
import { jsonOk } from "../http/response.js";

export interface ConfigRouteService {
	loadConfig: () => Promise<AppConfig>;
	saveConfig: (config: AppConfig) => Promise<void>;
	listAvailableModels: () => unknown;
	reloadActiveResources: () => Promise<void>;
}

export const defaultConfigRouteService: ConfigRouteService = {
	loadConfig: async () => AppConfigSchema.parse(await loadConfig()),
	saveConfig: async (config) => saveConfig(config),
	listAvailableModels,
	reloadActiveResources: async () => {
		await reloadActiveResources();
	},
};

export function createConfigRoutes(service: ConfigRouteService): Hono {
	const router = new Hono();

	router.get("/", async (c) => {
		const config = AppConfigSchema.parse(await service.loadConfig());
		return jsonOk(c, config);
	});

	router.post("/", async (c) => {
		const patch = await parseValidatedBody(c, ConfigPatchSchema);
		const current = AppConfigSchema.parse(await service.loadConfig());
		const next = applyConfigPatch(current, patch);
		await service.saveConfig(next);
		if (shouldReloadResources(current, patch)) {
			await service.reloadActiveResources();
		}
		return jsonOk(c, AppConfigSchema.parse(next));
	});

	return router;
}

export function createModelRoutes(service: ConfigRouteService): Hono {
	const router = new Hono();
	router.get("/", (c) => {
		return jsonOk(c, AvailableModelsDataSchema.parse(service.listAvailableModels()));
	});
	return router;
}

function applyConfigPatch(current: AppConfig, patch: ConfigPatch): AppConfig {
	const next: AppConfig = { ...current };
	if (patch.showUserGlobalSkills !== undefined) {
		next.showUserGlobalSkills = patch.showUserGlobalSkills;
	}
	if (patch.modelRoles !== undefined) {
		next.modelRoles = {
			...(current.modelRoles ?? {}),
			...(patch.modelRoles.main !== undefined ? { main: patch.modelRoles.main } : {}),
			...(patch.modelRoles.digest !== undefined ? { digest: patch.modelRoles.digest } : {}),
		};
	}
	if (patch.uiPrefs !== undefined) {
		next.uiPrefs = {
			...(current.uiPrefs ?? {}),
			...(patch.uiPrefs.sidebarExpandedKbs !== undefined
				? { sidebarExpandedKbs: patch.uiPrefs.sidebarExpandedKbs }
				: {}),
		};
	}
	return next;
}

function shouldReloadResources(current: AppConfig, patch: ConfigPatch): boolean {
	if (
		patch.showUserGlobalSkills !== undefined &&
		patch.showUserGlobalSkills !== current.showUserGlobalSkills
	) {
		return true;
	}
	if (patch.modelRoles?.main !== undefined) {
		return !sameModelRef(current.modelRoles?.main, patch.modelRoles.main);
	}
	return false;
}

function sameModelRef(a: unknown, b: unknown): boolean {
	const schema = ModelRefSchema.nullable();
	const left = schema.safeParse(a);
	const right = schema.safeParse(b);
	if (!left.success && !right.success) return true;
	if (!left.success || !right.success) return false;
	if (left.data === null || right.data === null) return left.data === right.data;
	return left.data.provider === right.data.provider && left.data.modelId === right.data.modelId;
}
