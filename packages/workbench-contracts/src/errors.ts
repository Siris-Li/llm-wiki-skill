import { z } from "zod";

/**
 * Workbench HTTP 第一批稳定错误码。
 *
 * 前端业务逻辑只依赖 code 做程序化判断，不依赖中文 message。新增 code 是
 * 可接受的演进，但已有 code 的语义保持不变。错误码用稳定英文。
 */
export const WorkbenchErrorCodeSchema = z.enum([
	"INVALID_JSON", // JSON body 解析失败
	"INVALID_REQUEST", // 字段类型不对或整体不符合 schema
	"MISSING_FIELD", // 缺少必填字段
	"NO_ACTIVE_KB", // 当前没有选择知识库
	"KB_NOT_REGISTERED", // 知识库未登记或已失效
	"FORBIDDEN_PATH", // 路径越界或无权限
	"FORBIDDEN_ORIGIN", // 请求来源不是工作台可信来源
	"FORBIDDEN_LOCAL_API", // 本地 API 缺少或携带了错误的 capability token
	"AUTHENTICATION_FAILED", // 认证连接测试未通过
	"NOT_FOUND", // 资源不存在
	"CONFLICT", // 资源冲突（如初始化已有库存在冲突文件）
	"UNSUPPORTED_PLATFORM", // 当前平台不支持
	"BUSY", // 资源忙（如当前对话正在生成）
	"INTERNAL_ERROR", // 兜底内部错误
]);
export type WorkbenchErrorCode = z.infer<typeof WorkbenchErrorCodeSchema>;

/**
 * 错误码到 HTTP 状态码的大类映射。HTTP 状态表达大类，code 表达精确原因。
 */
export const errorCodeToHttpStatus: Readonly<
	Record<WorkbenchErrorCode, number>
> = {
	INVALID_JSON: 400,
	INVALID_REQUEST: 400,
	MISSING_FIELD: 400,
	NO_ACTIVE_KB: 400,
	KB_NOT_REGISTERED: 404,
	FORBIDDEN_PATH: 403,
	FORBIDDEN_ORIGIN: 403,
	FORBIDDEN_LOCAL_API: 403,
	AUTHENTICATION_FAILED: 400,
	NOT_FOUND: 404,
	CONFLICT: 409,
	UNSUPPORTED_PLATFORM: 501,
	BUSY: 409,
	INTERNAL_ERROR: 500,
};

// ============= typed / redacted error details =============
//
// details 是失败 envelope 的结构化补充信息。
// 红线（由 schema 形状与构造方共同保证）：绝不包含本机绝对路径、Error.stack、
// API key、认证文件路径、原始 request body 或原始 prompt。
// 每个错误码对应一个公开 details schema；构造 details 时用对应 schema。

/** MISSING_FIELD：缺失字段名。 */
export const MissingFieldDetailsSchema = z.object({
	field: z.string(),
});
export type MissingFieldDetails = z.infer<typeof MissingFieldDetailsSchema>;

/** INVALID_REQUEST：字段级校验问题，不含原始 body。 */
export const InvalidRequestDetailsSchema = z.object({
	issues: z.array(
		z.object({
			path: z.string(),
			message: z.string(),
		}),
	),
});
export type InvalidRequestDetails = z.infer<typeof InvalidRequestDetailsSchema>;

/** FORBIDDEN_PATH：越界原因，不返回本机绝对路径。 */
export const ForbiddenPathDetailsSchema = z.object({
	reason: z.enum(["outside-root", "not-registered", "symlink-escape"]),
});
export type ForbiddenPathDetails = z.infer<typeof ForbiddenPathDetailsSchema>;

/** NOT_FOUND：可选资源标识（公开名 / 相对片段，非绝对路径）。 */
export const NotFoundDetailsSchema = z.object({
	resource: z.string().optional(),
});
export type NotFoundDetails = z.infer<typeof NotFoundDetailsSchema>;

/** CONFLICT：冲突文件名 / 相对片段列表，非本机绝对路径。 */
export const ConflictDetailsSchema = z.object({
	conflicts: z.array(z.string()).optional(),
});
export type ConflictDetails = z.infer<typeof ConflictDetailsSchema>;

/** INTERNAL_ERROR：dev/test 可带脱敏 diagnostic id，不带 stack / path / key。 */
export const InternalErrorDetailsSchema = z.object({
	diagnosticId: z.string().optional(),
});
export type InternalErrorDetails = z.infer<
	typeof InternalErrorDetailsSchema
>;

/**
 * details 字段的运行时总 schema：宽松结构化 JSON。envelope 解析时用它做形状
 * 校验；具体结构由对应 per-code schema 在构造方保证，前端按 code 判别。
 */
export const ErrorDetailsSchema = z.record(z.string(), z.unknown());
export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;
