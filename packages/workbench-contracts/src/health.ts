import { z } from "zod";

/**
 * GET /api/health 响应 data。
 *
 * health 是只读心跳端点，无副作用：不读写文件、不触发模型、不改配置、不发起 SSE。
 * 因此它在本地 API 信任边界里属于只读白名单，不需要可信来源 token（见 spec §9）。
 */
export const HealthDataSchema = z.object({
	status: z.literal("ok"),
	timestamp: z.number().int().nonnegative(),
	service: z.string(),
});
export type HealthData = z.infer<typeof HealthDataSchema>;
