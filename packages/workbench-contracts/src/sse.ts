import { z } from "zod";

/** All workbench SSE contracts currently use the same wire schema version. */
export const WORKBENCH_SSE_SCHEMA_VERSION = 1 as const;

/** Shared identity for finite work such as prompt and batch digest runs. */
export const RunSseEventIdentitySchema = z.object({
	schemaVersion: z.literal(WORKBENCH_SSE_SCHEMA_VERSION),
	runId: z.string().min(1),
	seq: z.number().int().positive(),
});

/** Shared identity for long-lived subscriptions that do not belong to a message. */
export const StreamSseEventIdentitySchema = z.object({
	schemaVersion: z.literal(WORKBENCH_SSE_SCHEMA_VERSION),
	streamId: z.string().min(1),
	seq: z.number().int().positive(),
});
