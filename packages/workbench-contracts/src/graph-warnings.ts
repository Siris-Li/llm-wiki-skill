import { z } from "zod";

export const GraphWarningCodeSchema = z.enum([
	"duplicate_node_id",
	"duplicate_edge_id",
	"duplicate_community_id",
	"generated_id_collision",
	"ambiguous_wikilink",
	"broken_wikilink",
	"pending_wikilink",
	"noncanonical_wikilink",
	"portable_path_collision",
]);
export type GraphWarningCodeContract = z.infer<typeof GraphWarningCodeSchema>;

export const GraphWarningSeveritySchema = z.enum(["error", "warning"]);
export type GraphWarningSeverityContract = z.infer<typeof GraphWarningSeveritySchema>;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function isRelativePosixPath(value: string): boolean {
	if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
		return false;
	}
	const segments = value.split("/");
	return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const KnowledgeBaseRelativePathSchema = z.string().refine(isRelativePosixPath, {
	message: "must be a POSIX knowledge-base-relative path",
});

const WarningDetailsRefSchema = KnowledgeBaseRelativePathSchema.refine(
	(value) => value.split("/").at(-1) === "graph-warnings.json",
	{ message: "must name graph-warnings.json" },
);

export const GraphWarningSummarySchema = z
	.object({
		build_id: Sha256Schema,
		total_groups: z.number().int().nonnegative(),
		total_occurrences: z.number().int().nonnegative(),
		error_occurrences: z.number().int().nonnegative(),
		warning_occurrences: z.number().int().nonnegative(),
		by_code: z.partialRecord(GraphWarningCodeSchema, z.number().int().nonnegative()),
		details_ref: WarningDetailsRefSchema,
		details_sha256: Sha256Schema,
	})
	.strict()
	.refine((value) => value.error_occurrences + value.warning_occurrences === value.total_occurrences, {
		message: "occurrence totals must match",
	})
	.refine(
		(value) => Object.values(value.by_code).reduce((total, count) => total + count, 0) === value.total_occurrences,
		{ message: "by_code totals must match" },
	);
export type GraphWarningSummaryContract = z.infer<typeof GraphWarningSummarySchema>;

export const GraphWarningCandidateSetSchema = z
	.object({
		candidate_set_id: z.string().min(1),
		candidate_count: z.number().int().nonnegative(),
		candidates: z.array(KnowledgeBaseRelativePathSchema),
	})
	.strict()
	.refine((value) => value.candidate_count === value.candidates.length, {
		message: "candidate_count must match candidates",
	})
	.refine((value) => new Set(value.candidates).size === value.candidates.length, {
		message: "candidate paths must be unique",
	});
export type GraphWarningCandidateSetContract = z.infer<typeof GraphWarningCandidateSetSchema>;

const PublicWarningIdSchema = z.string().regex(/^warning-[a-f0-9]{16}$/);
const PublicCandidateSetIdSchema = z.string().regex(/^candidate-set-[a-f0-9]{16}$/);
const PublicOccurrenceIdSchema = z.string().regex(/^occurrence-[a-f0-9]{16}$/);

export const GraphWarningOccurrenceSchema = z
	.object({
		occurrence_id: z.string().min(1),
		source_path: KnowledgeBaseRelativePathSchema,
		line: z.number().int().positive(),
		column: z.number().int().positive(),
		start_byte: z.number().int().nonnegative(),
		end_byte: z.number().int().nonnegative(),
		raw_link: z.string(),
		file_sha256: Sha256Schema,
		link_kind: z.enum(["page_wikilink", "same_page_anchor", "attachment_wikilink"]),
		read_only: z.boolean(),
	})
	.strict()
	.refine((value) => value.end_byte > value.start_byte, {
		message: "end_byte must be greater than start_byte",
	});
export type GraphWarningOccurrenceContract = z.infer<typeof GraphWarningOccurrenceSchema>;

export const GraphWarningGroupSchema = z
	.object({
		warning_id: z.string().min(1),
		code: GraphWarningCodeSchema,
		severity: GraphWarningSeveritySchema,
		message: z.string().min(1),
		id: z.string().min(1).optional(),
		target_key: z.string().min(1).optional(),
		candidate_set_id: z.string().min(1).optional(),
		occurrence_count: z.number().int().nonnegative(),
		occurrences: z.array(GraphWarningOccurrenceSchema),
	})
	.strict()
	.refine((value) => value.occurrence_count >= value.occurrences.length, {
		message: "occurrence_count cannot be smaller than occurrences",
	});
export type GraphWarningGroupContract = z.infer<typeof GraphWarningGroupSchema>;

export const GraphWarningPublicCandidateSetSchema = z
	.object({
		candidate_set_id: PublicCandidateSetIdSchema,
		candidate_count: z.number().int().nonnegative(),
		candidates: z.array(KnowledgeBaseRelativePathSchema),
	})
	.strict()
	.refine((value) => value.candidate_count === value.candidates.length, {
		message: "candidate_count must match candidates",
	})
	.refine((value) => new Set(value.candidates).size === value.candidates.length, {
		message: "candidate paths must be unique",
	});
export type GraphWarningPublicCandidateSetContract = z.infer<typeof GraphWarningPublicCandidateSetSchema>;

export const GraphWarningPublicOccurrenceSchema = z
	.object({
		occurrence_id: PublicOccurrenceIdSchema,
		source_path: KnowledgeBaseRelativePathSchema,
		line: z.number().int().positive(),
		column: z.number().int().positive(),
		link_kind: z.enum(["page_wikilink", "same_page_anchor", "attachment_wikilink"]),
		read_only: z.boolean(),
	})
	.strict();
export type GraphWarningPublicOccurrenceContract = z.infer<typeof GraphWarningPublicOccurrenceSchema>;

export const GraphWarningPublicGroupSchema = z
	.object({
		warning_id: PublicWarningIdSchema,
		code: GraphWarningCodeSchema,
		severity: GraphWarningSeveritySchema,
		candidate_set_id: PublicCandidateSetIdSchema.optional(),
		occurrence_count: z.number().int().nonnegative(),
		occurrences: z.array(GraphWarningPublicOccurrenceSchema),
	})
	.strict()
	.refine((value) => value.occurrence_count >= value.occurrences.length, {
		message: "occurrence_count cannot be smaller than occurrences",
	});
export type GraphWarningPublicGroupContract = z.infer<typeof GraphWarningPublicGroupSchema>;

function hasUniqueIds<T>(items: T[], id: (item: T) => string): boolean {
	return new Set(items.map(id)).size === items.length;
}

function referencedCandidateSetsMatch(
	groups: Array<{ candidate_set_id?: string }>,
	candidateSets: Array<{ candidate_set_id: string }>,
): boolean {
	const referenced = new Set(groups.flatMap((group) => group.candidate_set_id ? [group.candidate_set_id] : []));
	const supplied = new Set(candidateSets.map((candidateSet) => candidateSet.candidate_set_id));
	return referenced.size === supplied.size && [...referenced].every((id) => supplied.has(id));
}

function fullBundleCountsMatch(
	summary: GraphWarningSummaryContract,
	groups: GraphWarningGroupContract[],
): boolean {
	const byCode: Partial<Record<GraphWarningCodeContract, number>> = {};
	let errorOccurrences = 0;
	let warningOccurrences = 0;
	for (const group of groups) {
		byCode[group.code] = (byCode[group.code] ?? 0) + group.occurrence_count;
		if (group.severity === "error") errorOccurrences += group.occurrence_count;
		else warningOccurrences += group.occurrence_count;
	}
	const actualByCode = Object.entries(byCode).sort(([left], [right]) => left.localeCompare(right));
	const declaredByCode = Object.entries(summary.by_code).sort(([left], [right]) => left.localeCompare(right));
	return summary.total_groups === groups.length
		&& summary.total_occurrences === errorOccurrences + warningOccurrences
		&& summary.error_occurrences === errorOccurrences
		&& summary.warning_occurrences === warningOccurrences
		&& JSON.stringify(declaredByCode) === JSON.stringify(actualByCode);
}

export const GraphWarningBundleSchema = z
	.object({
		version: z.literal(1),
		build_id: Sha256Schema,
		summary: GraphWarningSummarySchema,
		candidate_sets: z.array(GraphWarningCandidateSetSchema),
		groups: z.array(GraphWarningGroupSchema),
	})
	.strict()
	.refine((value) => value.build_id === value.summary.build_id, {
		message: "bundle build_id must match summary",
	})
	.refine((value) => hasUniqueIds(value.groups, (group) => group.warning_id), {
		message: "warning IDs must be unique",
	})
	.refine((value) => hasUniqueIds(value.candidate_sets, (candidateSet) => candidateSet.candidate_set_id), {
		message: "candidate set IDs must be unique",
	})
	.refine((value) => value.groups.every((group) => group.occurrence_count === group.occurrences.length), {
		message: "complete bundle occurrence counts must match occurrences",
	})
	.refine((value) => hasUniqueIds(
		value.groups.flatMap((group) => group.occurrences),
		(occurrence) => occurrence.occurrence_id,
	), {
		message: "occurrence IDs must be unique across the complete bundle",
	})
	.refine((value) => fullBundleCountsMatch(value.summary, value.groups), {
		message: "complete bundle summary counts must match groups",
	})
	.refine((value) => value.groups.every((group) => !group.candidate_set_id || value.candidate_sets.some((set) => set.candidate_set_id === group.candidate_set_id)), {
		message: "warning references a missing candidate set",
	});
export type GraphWarningBundleContract = z.infer<typeof GraphWarningBundleSchema>;

export const GraphWarningDetailsStatusSchema = z.enum(["available", "unavailable"]);
export const GraphWarningDetailsUnavailableReasonSchema = z.enum([
	"legacy_without_summary",
	"missing",
	"invalid",
	"build_id_mismatch",
	"details_sha256_mismatch",
	"stale_cursor",
]);

const GraphWarningAvailableStateSchema = z
	.object({
		summary: GraphWarningSummarySchema,
		details_status: z.literal("available"),
		details_unavailable_reason: z.null(),
		engine_groups: z.array(GraphWarningPublicGroupSchema),
	})
	.strict();

const GraphWarningUnavailableStateSchema = z
	.object({
		summary: GraphWarningSummarySchema.nullable(),
		details_status: z.literal("unavailable"),
		details_unavailable_reason: GraphWarningDetailsUnavailableReasonSchema,
		engine_groups: z.array(GraphWarningPublicGroupSchema),
	})
	.strict();

export const GraphWarningStateSchema = z.discriminatedUnion("details_status", [
	GraphWarningAvailableStateSchema,
	GraphWarningUnavailableStateSchema,
]);
export type GraphWarningStateContract = z.infer<typeof GraphWarningStateSchema>;

export const GraphWarningPageQuerySchema = z
	.object({
		cursor: z.string().min(1).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(25),
	})
	.strict();
export type GraphWarningPageQueryContract = z.infer<typeof GraphWarningPageQuerySchema>;

const GraphWarningAvailablePageSchema = z
	.object({
		details_status: z.literal("available"),
		build_id: Sha256Schema,
		summary: GraphWarningSummarySchema,
		groups: z.array(GraphWarningPublicGroupSchema),
		candidate_sets: z.array(GraphWarningPublicCandidateSetSchema),
		next_cursor: z.string().min(1).nullable(),
	})
	.strict()
	.refine((value) => value.build_id === value.summary.build_id, {
		message: "page build_id must match summary",
	})
	.refine((value) => hasUniqueIds(value.groups, (group) => group.warning_id), {
		message: "page warning IDs must be unique",
	})
	.refine((value) => hasUniqueIds(value.candidate_sets, (candidateSet) => candidateSet.candidate_set_id), {
		message: "page candidate set IDs must be unique",
	})
	.refine((value) => referencedCandidateSetsMatch(value.groups, value.candidate_sets), {
		message: "page candidate sets must exactly match group references",
	});

const GraphWarningUnavailablePageSchema = z
	.object({
		details_status: z.literal("unavailable"),
		summary: GraphWarningSummarySchema.nullable(),
		details_unavailable_reason: GraphWarningDetailsUnavailableReasonSchema,
	})
	.strict();

export const GraphWarningPageDataSchema = z.union([
	GraphWarningAvailablePageSchema,
	GraphWarningUnavailablePageSchema,
]);
export type GraphWarningPageContract = z.infer<typeof GraphWarningPageDataSchema>;
