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
	type GraphWarningCodeContract,
	type GraphWarningGroupContract,
	type GraphWarningPageContract,
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

type WarningUnavailableReason = Exclude<
	GraphWarningStateContract["details_unavailable_reason"],
	null
>;

const scheduledRebuilds = new Set<string>();

const SAFE_WARNING_MESSAGES: Record<GraphWarningCodeContract, string> = {
	duplicate_node_id: "输入中有多个节点使用同一标识，图谱只保留首个有效节点。",
	duplicate_edge_id: "输入中有多个关系使用同一标识，图谱只保留首个有效关系。",
	duplicate_community_id: "输入中有多个社区使用同一标识，图谱只保留首个有效社区。",
	generated_id_collision: "自动生成的标识发生冲突，系统已改用另一个稳定标识。",
	ambiguous_wikilink: "这个链接可能指向多个页面，因此没有自动建立关系。",
	broken_wikilink: "这个链接找不到对应页面，因此没有建立关系。",
	pending_wikilink: "这个链接指向尚未创建的页面，页面创建后可重新构建图谱。",
	noncanonical_wikilink: "这个链接可以找到页面，但写法与实际路径不一致。",
	portable_path_collision: "这些路径在其他操作系统上可能被视为同一路径。",
};

export async function readGraphWarningContext(input: {
	kbPath: string;
	graphPath: string;
	graphData: GraphData;
	scheduleRebuild: (kbPath: string) => unknown;
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
	const groups = context.bundle.groups.slice(offset, end).map(publicWarningGroup);
	const referencedCandidateSetIds = new Set(
		groups.flatMap((group) => group.candidate_set_id ? [group.candidate_set_id] : []),
	);
	const candidateSets = context.bundle.candidate_sets.filter((candidateSet) => (
		referencedCandidateSetIds.has(candidateSet.candidate_set_id)
	));
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
		scheduleRebuild: (kbPath: string) => unknown;
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
	input: { kbPath: string; scheduleRebuild: (kbPath: string) => unknown },
	buildId: string,
	reason: WarningUnavailableReason,
): void {
	const key = `${input.kbPath}\0${buildId}\0${reason}`;
	if (scheduledRebuilds.has(key)) return;
	scheduledRebuilds.add(key);
	try {
		const scheduled = input.scheduleRebuild(input.kbPath);
		if (scheduled instanceof Promise) void scheduled.catch(() => {});
	} catch {
		// The readable graph state is independent from rebuild scheduling failures.
	}
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

function publicWarningGroup(group: GraphWarningGroupContract): GraphWarningGroupContract {
	return {
		...group,
		message: SAFE_WARNING_MESSAGES[group.code],
	};
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
