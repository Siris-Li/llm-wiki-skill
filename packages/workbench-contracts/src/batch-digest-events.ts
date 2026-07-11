import { z } from "zod";

import { ModelRefSchema } from "./config.js";
import { ErrorDetailsSchema, WorkbenchErrorCodeSchema } from "./errors.js";
import {
	RunSseEventIdentitySchema,
	WORKBENCH_SSE_SCHEMA_VERSION,
} from "./sse.js";

export const BATCH_DIGEST_SSE_SCHEMA_VERSION = WORKBENCH_SSE_SCHEMA_VERSION;

export const BatchDigestRequestBodySchema = z
	.object({
		kbPath: z.string().trim().min(1),
		filePaths: z.array(z.string().min(1)).min(1),
		concurrency: z.union([z.literal(1), z.literal(3), z.literal(5)]).optional(),
		sourceScanId: z.string().min(1).optional(),
		digestModel: ModelRefSchema.nullable().optional(),
	})
	.strict();
export type BatchDigestRequestBody = z.infer<typeof BatchDigestRequestBodySchema>;

// A batch is a finite run, but it is not an assistant message. `batchId` is the
// domain identity that replaces prompt's `messageId` for every event in the run.
const BatchDigestEventIdentitySchema = RunSseEventIdentitySchema.extend({
	batchId: z.string().min(1),
});

const BatchFileIdentitySchema = z.object({
	index: z.number().int().nonnegative(),
	filePath: z.string().min(1),
});

export const BatchStartedEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_started"),
	total: z.number().int().positive(),
	concurrency: z.union([z.literal(1), z.literal(3), z.literal(5)]),
	outputDir: z.string().min(1),
}).strict();

export const BatchFileStartedEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_file_started"),
	...BatchFileIdentitySchema.shape,
}).strict();

export const BatchFileProgressEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_file_progress"),
	...BatchFileIdentitySchema.shape,
	chars: z.number().int().nonnegative(),
}).strict();

export const BatchFileCompletedEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_file_completed"),
	...BatchFileIdentitySchema.shape,
	outputPath: z.string().min(1),
}).strict();

export const BatchFileFailedEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_file_failed"),
	...BatchFileIdentitySchema.shape,
	message: z.string().min(1),
}).strict();

export const BatchCompletedEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_completed"),
	total: z.number().int().positive(),
	completed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	outputDir: z.string().min(1),
}).strict();

export const BatchCancelledEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_cancelled"),
	reason: z.string().min(1),
}).strict();

export const BatchFailedEventSchema = BatchDigestEventIdentitySchema.extend({
	type: z.literal("batch_failed"),
	code: WorkbenchErrorCodeSchema,
	message: z.string().min(1),
	details: ErrorDetailsSchema.optional(),
}).strict();

export const BatchDigestSseEventSchema = z.discriminatedUnion("type", [
	BatchStartedEventSchema,
	BatchFileStartedEventSchema,
	BatchFileProgressEventSchema,
	BatchFileCompletedEventSchema,
	BatchFileFailedEventSchema,
	BatchCompletedEventSchema,
	BatchCancelledEventSchema,
	BatchFailedEventSchema,
]);
export type BatchDigestSseEvent = z.infer<typeof BatchDigestSseEventSchema>;

export const BATCH_DIGEST_SSE_EVENT_TYPES = BatchDigestSseEventSchema.options.map(
	(schema) => schema.shape.type.value,
);

export const BATCH_DIGEST_TERMINAL_EVENT_TYPES = [
	"batch_completed",
	"batch_cancelled",
	"batch_failed",
] as const satisfies readonly BatchDigestSseEvent["type"][];

const BATCH_DIGEST_TERMINAL_EVENT_TYPE_SET = new Set<BatchDigestSseEvent["type"]>(
	BATCH_DIGEST_TERMINAL_EVENT_TYPES,
);

export type BatchDigestTerminalEvent = Extract<
	BatchDigestSseEvent,
	{ type: (typeof BATCH_DIGEST_TERMINAL_EVENT_TYPES)[number] }
>;

export function isBatchDigestTerminalEvent(
	event: Pick<BatchDigestSseEvent, "type">,
): event is BatchDigestTerminalEvent {
	return BATCH_DIGEST_TERMINAL_EVENT_TYPE_SET.has(event.type);
}
