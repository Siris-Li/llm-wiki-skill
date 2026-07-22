import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import {
	projectGraphInput,
	type GraphData,
	type GraphWarningBundle,
} from "@llm-wiki/graph-engine";
import {
	GraphWarningBundleSchema,
	GraphWarningGroupSchema,
	GraphWarningPageDataSchema,
	GraphWarningSummarySchema,
	type GraphWarningGroupContract,
	type GraphWarningPageContract,
	type GraphWarningPublicCandidateSetContract,
	type GraphWarningPublicGroupContract,
	type GraphWarningStateContract,
	type GraphWarningSummaryContract,
} from "@llm-wiki/workbench-contracts";

import { HttpContractError } from "./http/request.js";

const require = createRequire(import.meta.url);
const { verifyGraphArtifactPair } = require("../../../scripts/lib/graph-warning-bundle.js") as {
	verifyGraphArtifactPair(input: {
		kbRoot: string;
		graphPath: string;
		warningPath: string;
	}): Promise<
		| { status: "available"; graphData: GraphData; warningBundle: GraphWarningBundle }
		| { status: "unavailable"; reason: string; summary: unknown }
	>;
};

export interface GraphWarningContext {
	publicState: GraphWarningStateContract;
	bundle: GraphWarningBundle | null;
}

export interface GraphRebuildScheduleOptions {
	onFailure?: () => void;
}

type ScheduleRebuild = (
	kbPath: string,
	options?: GraphRebuildScheduleOptions,
) => unknown;

type WarningUnavailableReason = Exclude<
	GraphWarningStateContract["details_unavailable_reason"],
	null
>;

const scheduledRebuilds = new Map<string, symbol>();

export async function readGraphWarningContext(input: {
	kbPath: string;
	graphPath: string;
	graphData: GraphData;
	scheduleRebuild: ScheduleRebuild;
}): Promise<GraphWarningContext> {
	const rawSummary = input.graphData.meta?.warning_summary;
	const parsedSummary = GraphWarningSummarySchema.safeParse(rawSummary);
	if (!rawSummary) {
		return unavailableContext(input, null, "legacy_without_summary", null);
	}
	if (!parsedSummary.success) {
		return unavailableContext(input, null, "invalid", null);
	}

	const summary = parsedSummary.data;
	const warningPath = path.resolve(input.kbPath, ...summary.details_ref.split("/"));
	const verified = await verifyGraphArtifactPair({
		kbRoot: input.kbPath,
		graphPath: input.graphPath,
		warningPath,
	});
	if (verified.status !== "available") {
		return unavailableContext(
			input,
			summary,
			mapVerificationReason(verified.reason),
			null,
		);
	}

	const parsedBundle = GraphWarningBundleSchema.safeParse(verified.warningBundle);
	if (!parsedBundle.success) {
		return unavailableContext(input, summary, "invalid", null);
	}
	if (!sameJson(verified.graphData, input.graphData)) {
		return unavailableContext(input, summary, "build_id_mismatch", null);
	}

	const bundle = parsedBundle.data as GraphWarningBundle;
	const engineGroups = defensiveEngineGroups(input.graphData, bundle);
	clearScheduledRebuilds(input.kbPath);
	return {
		publicState: {
			summary,
			details_status: "available",
			details_unavailable_reason: null,
			engine_groups: engineGroups,
		},
		bundle,
	};
}

export function paginateGraphWarningContext(
	context: GraphWarningContext,
	query: { cursor?: string; limit: number },
): GraphWarningPageContract {
	const cursor = query.cursor ? decodeCursor(query.cursor) : null;
	const currentBuildId = context.publicState.summary?.build_id ?? context.bundle?.build_id ?? null;
	if (cursor && currentBuildId && cursor.build_id !== currentBuildId) {
		return GraphWarningPageDataSchema.parse({
			details_status: "unavailable",
			summary: context.publicState.summary,
			details_unavailable_reason: "stale_cursor",
		});
	}

	if (context.publicState.details_status === "unavailable" || !context.bundle) {
		return GraphWarningPageDataSchema.parse({
			details_status: "unavailable",
			summary: context.publicState.summary,
			details_unavailable_reason: context.publicState.details_unavailable_reason,
		});
	}

	const offset = cursor?.offset ?? 0;
	if (cursor && (cursor.build_id !== context.bundle.build_id || offset <= 0 || offset >= context.bundle.groups.length)) {
		throw invalidCursor();
	}
	const end = Math.min(offset + query.limit, context.bundle.groups.length);
	const internalGroups = context.bundle.groups.slice(offset, end);
	const groups = internalGroups.map(publicWarningGroup);
	const referencedCandidateSetIds = new Set(
		internalGroups.flatMap((group) => group.candidate_set_id ? [group.candidate_set_id] : []),
	);
	const candidateSets = context.bundle.candidate_sets.filter((candidateSet) => (
		referencedCandidateSetIds.has(candidateSet.candidate_set_id)
	)).map(publicCandidateSet);
	const nextCursor = end < context.bundle.groups.length
		? encodeCursor({ version: 1, build_id: context.bundle.build_id, offset: end })
		: null;

	return GraphWarningPageDataSchema.parse({
		details_status: "available",
		build_id: context.bundle.build_id,
		summary: context.publicState.summary,
		groups,
		candidate_sets: candidateSets,
		next_cursor: nextCursor,
	});
}

function unavailableContext(
	input: {
		kbPath: string;
		graphData: GraphData;
		scheduleRebuild: ScheduleRebuild;
	},
	summary: GraphWarningSummaryContract | null,
	reason: WarningUnavailableReason,
	bundle: GraphWarningBundle | null,
): GraphWarningContext {
	scheduleRebuildOnce(input, summary?.build_id ?? rawBuildId(input.graphData), reason);
	return {
		publicState: {
			summary,
			details_status: "unavailable",
			details_unavailable_reason: reason,
			engine_groups: defensiveEngineGroups(input.graphData, bundle),
		},
		bundle: null,
	};
}

function scheduleRebuildOnce(
	input: { kbPath: string; scheduleRebuild: ScheduleRebuild },
	buildId: string,
	reason: WarningUnavailableReason,
): void {
	const key = `${input.kbPath}\0${buildId}\0${reason}`;
	if (scheduledRebuilds.has(key)) return;
	const token = Symbol(key);
	scheduledRebuilds.set(key, token);
	const release = () => {
		if (scheduledRebuilds.get(key) === token) scheduledRebuilds.delete(key);
	};
	try {
		const scheduled = input.scheduleRebuild(input.kbPath, { onFailure: release });
		if (isFailedScheduleResult(scheduled)) release();
		if (isPromiseLike(scheduled)) {
			void Promise.resolve(scheduled).then((result) => {
				if (isFailedScheduleResult(result)) release();
			}, release);
		}
	} catch {
		release();
	}
}

function clearScheduledRebuilds(kbPath: string): void {
	const prefix = `${kbPath}\0`;
	for (const key of scheduledRebuilds.keys()) {
		if (key.startsWith(prefix)) scheduledRebuilds.delete(key);
	}
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return Boolean(value && typeof (value as { then?: unknown }).then === "function");
}

function isFailedScheduleResult(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const result = value as { ok?: unknown; status?: unknown };
	return result.ok === false || result.status === "failed" || result.status === "failure";
}

function rawBuildId(graphData: GraphData): string {
	const value = (graphData.meta?.warning_summary as { build_id?: unknown } | undefined)?.build_id;
	return typeof value === "string" ? value : "legacy";
}

function defensiveEngineGroups(graphData: GraphData, bundle: GraphWarningBundle | null) {
	const persistedIds = new Set(bundle?.groups.map((group) => group.warning_id) ?? []);
	const projected = projectGraphInput(graphData, bundle?.groups ?? []);
	return projected.warnings
		.filter((group) => !persistedIds.has(group.warning_id))
		.map((group) => publicWarningGroup(GraphWarningGroupSchema.parse(group)));
}

function publicWarningGroup(group: GraphWarningGroupContract): GraphWarningPublicGroupContract {
	return {
		warning_id: publicOpaqueId("warning", group.warning_id),
		code: group.code,
		severity: group.severity,
		...(group.candidate_set_id
			? { candidate_set_id: publicOpaqueId("candidate-set", group.candidate_set_id) }
			: {}),
		occurrence_count: group.occurrence_count,
		occurrences: group.occurrences.map((occurrence) => ({
			occurrence_id: publicOpaqueId("occurrence", occurrence.occurrence_id),
			source_path: occurrence.source_path,
			line: occurrence.line,
			column: occurrence.column,
			link_kind: occurrence.link_kind,
			read_only: occurrence.read_only,
		})),
	};
}

function publicCandidateSet(candidateSet: GraphWarningBundle["candidate_sets"][number]): GraphWarningPublicCandidateSetContract {
	return {
		candidate_set_id: publicOpaqueId("candidate-set", candidateSet.candidate_set_id),
		candidate_count: candidateSet.candidate_count,
		candidates: candidateSet.candidates,
	};
}

function publicOpaqueId(prefix: "warning" | "candidate-set" | "occurrence", internalValue: string): string {
	const digest = createHash("sha256").update(`${prefix}\0${internalValue}`, "utf8").digest("hex").slice(0, 16);
	return `${prefix}-${digest}`;
}

function mapVerificationReason(reason: string): WarningUnavailableReason {
	switch (reason) {
		case "missing":
			return "missing";
		case "build_id_mismatch":
			return "build_id_mismatch";
		case "details_sha256_mismatch":
			return "details_sha256_mismatch";
		default:
			return "invalid";
	}
}

type Cursor = { version: 1; build_id: string; offset: number };

function encodeCursor(cursor: Cursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): Cursor {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
	try {
		const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
		if (
			!decoded ||
			typeof decoded !== "object" ||
			Object.keys(decoded).sort().join(",") !== "build_id,offset,version" ||
			decoded.version !== 1 ||
			typeof decoded.build_id !== "string" ||
			!/^[a-f0-9]{64}$/.test(decoded.build_id) ||
			!Number.isSafeInteger(decoded.offset) ||
			Number(decoded.offset) < 0
		) {
			throw invalidCursor();
		}
		return decoded as Cursor;
	} catch (error) {
		if (error instanceof HttpContractError) throw error;
		throw invalidCursor();
	}
}

function invalidCursor(): HttpContractError {
	return new HttpContractError("INVALID_REQUEST", "告警分页游标无效");
}

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
