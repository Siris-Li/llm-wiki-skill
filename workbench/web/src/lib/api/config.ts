import {
	AppConfigSchema,
	AvailableModelsDataSchema,
	ConfigPatchSchema,
	type AppConfig,
	type AvailableModelsData,
	type ConfigPatch,
} from "@llm-wiki/workbench-contracts";

import { request } from "./client";

export function getConfig(): Promise<AppConfig> {
	return request("/api/config", { responseSchema: AppConfigSchema });
}

export function setConfig(partial: ConfigPatch): Promise<AppConfig> {
	return request("/api/config", {
		method: "POST",
		body: ConfigPatchSchema.parse(partial),
		responseSchema: AppConfigSchema,
	});
}

export function fetchAvailableModels(): Promise<AvailableModelsData> {
	return request("/api/models", { responseSchema: AvailableModelsDataSchema });
}
