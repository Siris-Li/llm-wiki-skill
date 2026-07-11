import { z } from "zod";

export const ModelRefSchema = z.object({
	provider: z.string().trim().min(1),
	modelId: z.string().trim().min(1),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const AppConfigSchema = z.object({
	version: z.literal(1),
	externalKnowledgeBases: z.array(z.string()),
	lastUsedKbPath: z.string().optional(),
	showUserGlobalSkills: z.boolean().optional(),
	modelRoles: z
		.object({
			main: ModelRefSchema.nullable().optional(),
			digest: ModelRefSchema.nullable().optional(),
		})
		.optional(),
	uiPrefs: z
		.object({
			sidebarExpandedKbs: z.array(z.string()).optional(),
		})
		.optional(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const ConfigPatchSchema = z.object({
	showUserGlobalSkills: z.boolean().optional(),
	modelRoles: z
		.object({
			main: ModelRefSchema.nullable().optional(),
			digest: ModelRefSchema.nullable().optional(),
		})
		.optional(),
	uiPrefs: z
		.object({
			sidebarExpandedKbs: z.array(z.string()).optional(),
		})
		.optional(),
});
export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

export const AvailableModelInfoSchema = z.object({
	provider: z.string(),
	modelId: z.string(),
	name: z.string(),
	reasoning: z.boolean(),
	contextWindow: z.number().int().nonnegative(),
	cost: z.object({ input: z.number(), output: z.number() }),
	hasAuth: z.boolean(),
});
export type AvailableModelInfo = z.infer<typeof AvailableModelInfoSchema>;

export const AvailableModelsDataSchema = z.array(AvailableModelInfoSchema);
export type AvailableModelsData = z.infer<typeof AvailableModelsDataSchema>;
