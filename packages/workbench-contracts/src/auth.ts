import { z } from "zod";

export const AuthSetBodySchema = z.object({
	provider: z.string().trim().toLowerCase().min(1),
	type: z.literal("api_key"),
	key: z.string().trim().min(1),
});
export type AuthSetBody = z.infer<typeof AuthSetBodySchema>;

export const AuthSetDataSchema = z.object({
	saved: z.literal(true),
});
export type AuthSetData = z.infer<typeof AuthSetDataSchema>;

export const AuthConnectionTestBodySchema = z.object({
	provider: z.string().trim().toLowerCase().min(1),
});
export type AuthConnectionTestBody = z.infer<typeof AuthConnectionTestBodySchema>;

export const AuthConnectionTestDataSchema = z.object({
	message: z.string().trim().min(1),
});
export type AuthConnectionTestData = z.infer<typeof AuthConnectionTestDataSchema>;

export const AuthProviderStatusSchema = z.object({
	id: z.string(),
	type: z.string(),
	configured: z.boolean(),
});
export type AuthProviderStatus = z.infer<typeof AuthProviderStatusSchema>;

export const AuthEnvKeyStatusSchema = z.object({
	name: z.string(),
	present: z.boolean(),
});
export type AuthEnvKeyStatus = z.infer<typeof AuthEnvKeyStatusSchema>;

export const AuthStatusDataSchema = z.object({
	authFileExists: z.boolean(),
	providers: z.array(AuthProviderStatusSchema),
	envKeys: z.array(AuthEnvKeyStatusSchema),
});
export type AuthStatusData = z.infer<typeof AuthStatusDataSchema>;
