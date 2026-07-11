import { z } from "zod";

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
