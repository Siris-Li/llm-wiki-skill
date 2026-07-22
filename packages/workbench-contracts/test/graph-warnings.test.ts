import assert from "node:assert/strict";
import test from "node:test";

import {
	GraphWarningBundleSchema,
	GraphWarningCandidateSetSchema,
	GraphWarningCodeSchema,
	GraphWarningOccurrenceSchema,
	GraphWarningPageDataSchema,
	GraphWarningPageQuerySchema,
	GraphWarningStateSchema,
	GraphWarningSummarySchema,
} from "../src/graph-warnings.js";

const buildId = "b".repeat(64);
const detailsSha256 = "d".repeat(64);

const summary = {
	build_id: buildId,
	total_groups: 9,
	total_occurrences: 9,
	error_occurrences: 6,
	warning_occurrences: 3,
	by_code: {
		duplicate_node_id: 1,
		duplicate_edge_id: 1,
		duplicate_community_id: 1,
		generated_id_collision: 1,
		ambiguous_wikilink: 1,
		broken_wikilink: 1,
		pending_wikilink: 1,
		noncanonical_wikilink: 1,
		portable_path_collision: 1,
	},
	details_ref: "wiki/graph-warnings.json",
	details_sha256: detailsSha256,
} as const;

const candidateSet = {
	candidate_set_id: "candidates-foo",
	candidate_count: 2,
	candidates: ["wiki/entities/foo.md", "wiki/topics/foo.md"],
} as const;

const occurrence = {
	occurrence_id: "occurrence-1",
	source_path: "wiki/synthesis/overview.md",
	line: 4,
	column: 7,
	start_byte: 12,
	end_byte: 19,
	raw_link: "[[foo]]",
	file_sha256: "a".repeat(64),
	link_kind: "page_wikilink",
	read_only: false,
} as const;

const warningCodes = [
	"duplicate_node_id",
	"duplicate_edge_id",
	"duplicate_community_id",
	"generated_id_collision",
	"ambiguous_wikilink",
	"broken_wikilink",
	"pending_wikilink",
	"noncanonical_wikilink",
	"portable_path_collision",
] as const;

const groups = warningCodes.map((code, index) => ({
	warning_id: `warning-${index}`,
	code,
	severity: (["generated_id_collision", "pending_wikilink", "noncanonical_wikilink"] as string[]).includes(code)
		? "warning" as const
		: "error" as const,
	message: `message for ${code}`,
	...(code === "ambiguous_wikilink" ? { target_key: "foo", candidate_set_id: candidateSet.candidate_set_id } : {}),
	occurrence_count: 1,
	occurrences: [{ ...occurrence, occurrence_id: `occurrence-${index}`, start_byte: index * 10, end_byte: index * 10 + 1 }],
}));

test("warning schemas accept every public warning code and preserve snake-case fields", () => {
	assert.deepEqual(GraphWarningCodeSchema.options, warningCodes);
	const bundle = {
		version: 1,
		build_id: buildId,
		summary,
		candidate_sets: [candidateSet],
		groups,
	};
	assert.deepEqual(GraphWarningBundleSchema.parse(bundle), bundle);
	assert.deepEqual(JSON.parse(JSON.stringify(GraphWarningBundleSchema.parse(bundle))), bundle);
	assert.equal(GraphWarningCodeSchema.safeParse("unknown_warning").success, false);
});

test("complete warning bundles reconcile every group and summary count with their full details", () => {
	const bundle = {
		version: 1 as const,
		build_id: buildId,
		summary,
		candidate_sets: [candidateSet],
		groups,
	};
	const cases = [
		{
			name: "group occurrence count",
			mutate(value: any) {
				value.groups[0].occurrence_count = 2;
				value.summary.total_occurrences = 10;
				value.summary.error_occurrences = 7;
				value.summary.by_code.duplicate_node_id = 2;
			},
		},
		{
			name: "summary group count",
			mutate(value: any) {
				value.summary.total_groups = 10;
			},
		},
		{
			name: "summary occurrence total",
			mutate(value: any) {
				value.summary.total_occurrences = 10;
				value.summary.error_occurrences = 7;
				value.summary.by_code.duplicate_node_id = 2;
			},
		},
		{
			name: "summary severity totals",
			mutate(value: any) {
				value.summary.error_occurrences = 5;
				value.summary.warning_occurrences = 4;
			},
		},
		{
			name: "summary code totals",
			mutate(value: any) {
				value.summary.by_code.duplicate_node_id = 0;
				value.summary.by_code.duplicate_edge_id = 2;
			},
		},
	];

	for (const testCase of cases) {
		const invalid = structuredClone(bundle);
		testCase.mutate(invalid);
		assert.equal(GraphWarningBundleSchema.safeParse(invalid).success, false, testCase.name);
	}

	const repeatedOccurrence = structuredClone(bundle);
	repeatedOccurrence.groups[1].occurrences[0].occurrence_id = repeatedOccurrence.groups[0].occurrences[0].occurrence_id;
	assert.equal(
		GraphWarningBundleSchema.safeParse(repeatedOccurrence).success,
		false,
		"occurrence IDs must be unique across the complete bundle",
	);
});

test("warning paths are strict POSIX knowledge-base-relative paths", () => {
	assert.equal(GraphWarningSummarySchema.safeParse(summary).success, true);
	assert.equal(GraphWarningSummarySchema.safeParse({ ...summary, details_ref: "generated/custom/graph-warnings.json" }).success, true);
	for (const details_ref of [
		"",
		"/tmp/graph-warnings.json",
		"C:/tmp/graph-warnings.json",
		"wiki\\graph-warnings.json",
		"./wiki/graph-warnings.json",
		"wiki/../graph-warnings.json",
		"../graph-warnings.json",
		"wiki//graph-warnings.json",
		"wiki/warnings.json",
	]) {
		assert.equal(GraphWarningSummarySchema.safeParse({ ...summary, details_ref }).success, false, details_ref);
	}

	for (const source_path of ["/Users/private/wiki/a.md", "../a.md", "wiki\\a.md", "wiki/./a.md"]) {
		assert.equal(GraphWarningOccurrenceSchema.safeParse({ ...occurrence, source_path }).success, false, source_path);
	}
	assert.equal(GraphWarningCandidateSetSchema.safeParse({ ...candidateSet, candidates: ["/Users/private/a.md", "wiki/a.md"] }).success, false);
});

test("warning positions and byte ranges reject impossible values", () => {
	for (const invalid of [
		{ ...occurrence, line: 0 },
		{ ...occurrence, column: 0 },
		{ ...occurrence, start_byte: -1 },
		{ ...occurrence, start_byte: 20, end_byte: 19 },
		{ ...occurrence, start_byte: 20, end_byte: 20 },
	]) {
		assert.equal(GraphWarningOccurrenceSchema.safeParse(invalid).success, false);
	}
});

test("warning state requires a reason exactly when details are unavailable", () => {
	const available = {
		summary,
		details_status: "available",
		details_unavailable_reason: null,
		engine_groups: [],
	} as const;
	assert.deepEqual(GraphWarningStateSchema.parse(available), available);
	for (const details_unavailable_reason of [
		"legacy_without_summary",
		"missing",
		"invalid",
		"build_id_mismatch",
		"details_sha256_mismatch",
		"stale_cursor",
	] as const) {
		const unavailable = {
			summary,
			details_status: "unavailable",
			details_unavailable_reason,
			engine_groups: [],
		} as const;
		assert.deepEqual(GraphWarningStateSchema.parse(unavailable), unavailable);
	}
	assert.equal(GraphWarningStateSchema.safeParse({ ...available, details_status: "unavailable" }).success, false);
	assert.equal(GraphWarningStateSchema.safeParse({ ...available, details_unavailable_reason: "missing" }).success, false);
});

test("warning page query coerces bounded integer limits and keeps an opaque cursor", () => {
	assert.deepEqual(GraphWarningPageQuerySchema.parse({}), { limit: 25 });
	assert.deepEqual(GraphWarningPageQuerySchema.parse({ limit: "100", cursor: "opaque+/=" }), { limit: 100, cursor: "opaque+/=" });
	for (const limit of ["0", "101", "1.5", "oops"]) {
		assert.equal(GraphWarningPageQuerySchema.safeParse({ limit }).success, false, limit);
	}
});

test("available warning pages carry only candidate sets referenced by their groups", () => {
	const publicCandidateSet = {
		...candidateSet,
		candidate_set_id: "candidate-set-1111111111111111",
	};
	const publicGroup = {
		warning_id: "warning-2222222222222222",
		code: "ambiguous_wikilink" as const,
		severity: "error" as const,
		candidate_set_id: publicCandidateSet.candidate_set_id,
		occurrence_count: 1,
		occurrences: [{
			occurrence_id: "occurrence-3333333333333333",
			source_path: occurrence.source_path,
			line: occurrence.line,
			column: occurrence.column,
			link_kind: occurrence.link_kind,
			read_only: occurrence.read_only,
		}],
	};
	const page = {
		details_status: "available",
		build_id: buildId,
		summary,
		groups: [publicGroup],
		candidate_sets: [publicCandidateSet],
		next_cursor: "next-page",
	} as const;
	assert.deepEqual(GraphWarningPageDataSchema.parse(page), page);
	assert.equal(GraphWarningPageDataSchema.safeParse({ ...page, candidate_sets: [] }).success, false);
	assert.equal(GraphWarningPageDataSchema.safeParse({ ...page, groups: [{ ...publicGroup, candidate_set_id: undefined }] }).success, false);
	for (const leakedField of [
		{ message: "/Users/private arbitrary raw text" },
		{ id: "C:\\private" },
		{ target_key: "portable-key:nfc|casefold" },
	]) {
		assert.equal(GraphWarningPageDataSchema.safeParse({
			...page,
			groups: [{ ...publicGroup, ...leakedField }],
		}).success, false, Object.keys(leakedField)[0]);
	}
	for (const leakedField of [
		{ raw_link: "[[/Users/private]]" },
		{ file_sha256: "a".repeat(64) },
		{ start_byte: 1 },
		{ end_byte: 2 },
	]) {
		assert.equal(GraphWarningPageDataSchema.safeParse({
			...page,
			groups: [{
				...publicGroup,
				occurrences: [{ ...publicGroup.occurrences[0], ...leakedField }],
			}],
		}).success, false, Object.keys(leakedField)[0]);
	}
	for (const unsafeId of ["/Users/private", "C:\\private", "portable-key:nfc|casefold", "arbitrary raw text"]) {
		assert.equal(GraphWarningPageDataSchema.safeParse({
			...page,
			groups: [{ ...publicGroup, warning_id: unsafeId }],
		}).success, false, unsafeId);
	}
	assert.deepEqual(GraphWarningPageDataSchema.parse({
		details_status: "unavailable",
		summary: null,
		details_unavailable_reason: "legacy_without_summary",
	}), {
		details_status: "unavailable",
		summary: null,
		details_unavailable_reason: "legacy_without_summary",
	});
});
