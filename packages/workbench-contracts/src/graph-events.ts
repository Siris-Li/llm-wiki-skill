import { z } from "zod";

import {
	StreamSseEventIdentitySchema,
	WORKBENCH_SSE_SCHEMA_VERSION,
} from "./sse.js";

export const GRAPH_SSE_SCHEMA_VERSION = WORKBENCH_SSE_SCHEMA_VERSION;
/** EventSource uses one known channel so unknown data.type values remain observable. */
export const GRAPH_SSE_EVENT_NAME = "message" as const;
export const GRAPH_SSE_READY_EVENT_TYPE = "graph_stream_ready" as const;

// Graph events form a long-lived read-only subscription, not a message run.
// `streamId` identifies one transport connection; a reconnect starts a new id
// with seq=1. Client close or transport disconnect is the lifecycle end rule.
const GraphEventIdentitySchema = StreamSseEventIdentitySchema;

export const GraphDiffSchema = z
	.object({
		addedNodes: z.array(z.string()),
		removedNodes: z.array(z.string()),
		recoloredNodes: z.array(
			z
				.object({
					id: z.string(),
					from: z.string(),
					to: z.string(),
				})
				.strict(),
		),
		addedEdges: z.array(z.string()),
		removedEdges: z.array(z.string()),
		newCommunities: z.array(z.string()),
		stats: z
			.object({
				nodeCount: z.number().int().nonnegative(),
				edgeCount: z.number().int().nonnegative(),
				communityCount: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();
export type GraphDiffContract = z.infer<typeof GraphDiffSchema>;

const GraphStatsSchema = z
	.object({
		nodeCount: z.number().int().nonnegative(),
		edgeCount: z.number().int().nonnegative(),
	})
	.strict();

export const GraphStreamReadyEventSchema = GraphEventIdentitySchema.extend({
	type: z.literal(GRAPH_SSE_READY_EVENT_TYPE),
	connectedAt: z.string().datetime(),
}).strict();

export const GraphUpdatedEventSchema = GraphEventIdentitySchema.extend({
	type: z.literal("graph_updated"),
	kbPath: z.string().min(1),
	diff: GraphDiffSchema.nullable(),
	rebuiltAt: z.string().datetime(),
	stats: GraphStatsSchema,
}).strict();

export const GraphErrorEventSchema = GraphEventIdentitySchema.extend({
	type: z.literal("graph_error"),
	kbPath: z.string().min(1),
	message: z.string().min(1),
	rebuiltAt: z.string().datetime(),
}).strict();

export const GraphSseEventSchema = z.discriminatedUnion("type", [
	GraphStreamReadyEventSchema,
	GraphUpdatedEventSchema,
	GraphErrorEventSchema,
]);
export type GraphSseEvent = z.infer<typeof GraphSseEventSchema>;

export const GRAPH_SSE_EVENT_TYPES = GraphSseEventSchema.options.map(
	(schema) => schema.shape.type.value,
);
