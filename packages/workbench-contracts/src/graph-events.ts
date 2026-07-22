import { z } from "zod";

import {
	StreamSseEventIdentitySchema,
	WORKBENCH_SSE_SCHEMA_VERSION,
} from "./sse.js";
import {
	GraphWarningDetailsStatusSchema,
	GraphWarningSummarySchema,
	KnowledgeBaseRelativePathSchema,
} from "./graph-warnings.js";

export const GRAPH_SSE_SCHEMA_VERSION = WORKBENCH_SSE_SCHEMA_VERSION;
/** EventSource uses one known channel so unknown data.type values remain observable. */
export const GRAPH_SSE_EVENT_NAME = "message" as const;
export const GRAPH_SSE_READY_EVENT_TYPE = "graph_stream_ready" as const;

// Graph events form a long-lived read-only subscription, not a message run.
// `streamId` identifies one transport connection; a reconnect starts a new id
// with seq=1. Client close or transport disconnect is the lifecycle end rule.
const GraphEventIdentitySchema = StreamSseEventIdentitySchema;

export type GraphMigrationWarningContract =
	| {
			code: "identity_alignment_ambiguous";
			source_path: string | null;
	  }
	| {
			code: "legacy_semantic_edge_duplicate";
	  };

export interface GraphDiffContract {
	addedNodes: string[];
	removedNodes: string[];
	recoloredNodes: Array<{ id: string; from: string; to: string }>;
	addedEdges: string[];
	removedEdges: string[];
	newCommunities: string[];
	migrationWarnings: GraphMigrationWarningContract[];
	stats: {
		nodeCount: number;
		edgeCount: number;
		communityCount: number;
	};
}

const GraphMigrationWarningSchema = z.discriminatedUnion("code", [
	z
		.object({
			code: z.literal("identity_alignment_ambiguous"),
			source_path: KnowledgeBaseRelativePathSchema.nullable(),
		})
		.strict(),
	z
		.object({
			code: z.literal("legacy_semantic_edge_duplicate"),
		})
		.strict(),
]);

const GraphEventIdentifierSchema = z.string().refine((value) => (
	KnowledgeBaseRelativePathSchema.safeParse(value).success
	|| /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
), { message: "must be a safe graph identifier" });

export const GraphDiffSchema = z
	.object({
		addedNodes: z.array(GraphEventIdentifierSchema),
		removedNodes: z.array(GraphEventIdentifierSchema),
		recoloredNodes: z.array(
			z
				.object({
				id: GraphEventIdentifierSchema,
				from: GraphEventIdentifierSchema,
				to: GraphEventIdentifierSchema,
				})
				.strict(),
		),
		addedEdges: z.array(GraphEventIdentifierSchema),
		removedEdges: z.array(GraphEventIdentifierSchema),
		newCommunities: z.array(GraphEventIdentifierSchema),
		migrationWarnings: z.array(GraphMigrationWarningSchema).default([]),
		stats: z
			.object({
				nodeCount: z.number().int().nonnegative(),
				edgeCount: z.number().int().nonnegative(),
				communityCount: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict()
	.transform((diff): GraphDiffContract => diff);

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
	diff: GraphDiffSchema.nullable(),
	rebuiltAt: z.string().datetime(),
	stats: GraphStatsSchema,
	warning_summary: GraphWarningSummarySchema.nullable(),
	warning_details_status: GraphWarningDetailsStatusSchema,
}).strict();

export const GraphErrorEventSchema = GraphEventIdentitySchema.extend({
	type: z.literal("graph_error"),
	message: z.literal("图谱重建失败"),
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
