import { AlertTriangle, ChevronDown, RefreshCw, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
	GraphWarningPageDataSchema,
	type GraphMigrationWarningContract,
	type GraphWarningCandidateSetContract,
	type GraphWarningCodeContract,
	type GraphWarningGroupContract,
	type GraphWarningPageContract,
	type GraphWarningStateContract,
} from "@llm-wiki/workbench-contracts";

const WARNING_LABELS: Record<GraphWarningCodeContract, string> = {
	duplicate_node_id: "节点 ID 重复",
	duplicate_edge_id: "关系 ID 重复",
	duplicate_community_id: "社区 ID 重复",
	generated_id_collision: "自动 ID 冲突",
	ambiguous_wikilink: "链接目标有歧义",
	broken_wikilink: "链接目标不存在",
	pending_wikilink: "链接目标待创建",
	noncanonical_wikilink: "链接写法不规范",
	portable_path_collision: "路径在其他系统可能冲突",
};

interface Props {
	warningState: GraphWarningStateContract;
	migrationWarnings?: GraphMigrationWarningContract[];
	loadPage: (cursor?: string, limit?: number) => Promise<GraphWarningPageContract>;
	onDismissMigrationWarnings?: () => void;
	onResolveWarning?: (
		group: GraphWarningGroupContract,
		candidateSet: GraphWarningCandidateSetContract,
	) => void;
}

export function GraphWarningsBanner({
	warningState,
	migrationWarnings = [],
	loadPage,
	onDismissMigrationWarnings,
	onResolveWarning,
}: Props) {
	const [expanded, setExpanded] = useState(false);
	const [groups, setGroups] = useState<GraphWarningGroupContract[]>([]);
	const [candidateSets, setCandidateSets] = useState<GraphWarningCandidateSetContract[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [unavailableBuildId, setUnavailableBuildId] = useState<string | null>(null);
	const [dismissedMigrationKey, setDismissedMigrationKey] = useState<string | null>(null);
	const migrationKey = JSON.stringify(migrationWarnings);
	const warningBuildId = warningState.summary?.build_id;
	const detailsUnavailable = warningState.details_status === "unavailable"
		|| (unavailableBuildId !== null && warningBuildId === unavailableBuildId);
	const migrationVisible = migrationWarnings.length > 0 && dismissedMigrationKey !== migrationKey;

	const codeCounts = useMemo(() => {
		const counts = new Map<GraphWarningCodeContract, number>();
		for (const [code, count] of Object.entries(warningState.summary?.by_code ?? {})) {
			if (count) counts.set(code as GraphWarningCodeContract, count);
		}
		for (const group of warningState.engine_groups) {
			counts.set(group.code, (counts.get(group.code) ?? 0) + Math.max(1, group.occurrence_count));
		}
		return counts;
	}, [warningState.engine_groups, warningState.summary]);

	const appendPage = useCallback((page: Extract<GraphWarningPageContract, { details_status: "available" }>) => {
		setGroups((current) => {
			const byId = new Map(current.map((group) => [group.warning_id, group]));
			for (const group of page.groups) byId.set(group.warning_id, group);
			return [...byId.values()];
		});
		setCandidateSets((current) => {
			const byId = new Map(current.map((candidateSet) => [candidateSet.candidate_set_id, candidateSet]));
			for (const candidateSet of page.candidate_sets) byId.set(candidateSet.candidate_set_id, candidateSet);
			return [...byId.values()];
		});
		setNextCursor(page.next_cursor);
	}, []);

	const requestPage = useCallback(async (cursor?: string) => {
		setLoading(true);
		setError(null);
		try {
			const page = GraphWarningPageDataSchema.parse(await loadPage(cursor, 25));
			if (page.details_status === "unavailable") {
				setUnavailableBuildId(warningBuildId ?? null);
				setNextCursor(null);
				return;
			}
			appendPage(page);
		} catch {
			setError("详情加载失败，请重试");
		} finally {
			setLoading(false);
		}
	}, [appendPage, loadPage, warningBuildId]);

	const showDetails = useCallback(() => {
		setExpanded(true);
		if (nextCursor === undefined && !loading) void requestPage();
	}, [loading, nextCursor, requestPage]);

	const summary = warningState.summary;
	const engineCount = warningState.engine_groups.reduce(
		(total, group) => total + Math.max(1, group.occurrence_count),
		0,
	);
	const candidateSetById = new Map(candidateSets.map((candidateSet) => [candidateSet.candidate_set_id, candidateSet]));

	return (
		<section className="graph-warnings-banner" role="region" aria-label="图谱告警" data-expanded={expanded ? "true" : "false"}>
			<div className="graph-warnings-summary">
				<AlertTriangle aria-hidden="true" />
				<div className="graph-warnings-summary-copy">
					<strong>图谱可读，但有内容需要留意</strong>
					<span>
						{summary?.error_occurrences ?? 0} 个错误 · {summary?.warning_occurrences ?? 0} 个提醒
						{engineCount > 0 ? ` · ${engineCount} 个输入检查项` : ""}
					</span>
				</div>
				{warningState.details_status === "available" && !detailsUnavailable && (
					<button
						type="button"
						className="graph-warnings-toggle"
						aria-expanded={expanded}
						onClick={showDetails}
					>
						<ChevronDown aria-hidden="true" />
						查看详情
					</button>
				)}
			</div>

			<div className="graph-warning-code-list" aria-label="告警类型">
				{[...codeCounts].map(([code, count]) => (
					<span key={code}><b>{WARNING_LABELS[code]}</b> {count}</span>
				))}
			</div>

			{detailsUnavailable && (
				<div className="graph-warning-unavailable" role="note">
					详情暂不可用，已安排重新构建。摘要和图谱仍可阅读。
				</div>
			)}

			{migrationVisible && migrationWarnings.length > 0 && (
				<div className="graph-migration-warnings">
					<div>
						<strong>首次刷新有 {migrationWarnings.length} 项迁移提示</strong>
						<button
							type="button"
							aria-label="关闭迁移提示"
							onClick={() => {
								setDismissedMigrationKey(migrationKey);
								onDismissMigrationWarnings?.();
							}}
						>
							<X aria-hidden="true" />
						</button>
					</div>
					<ul>
						{migrationWarnings.map((warning, index) => (
							<li key={`${warning.code}-${index}`}>
								{migrationWarningText(warning)}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className="graph-warning-live" role="status" aria-live="polite">
				{loading ? "正在加载告警详情" : ""}
			</div>
			{error && (
				<div className="graph-warning-error" role="alert">
					<span>{error}</span>
					<button type="button" onClick={() => void requestPage(nextCursor ?? undefined)}>
						<RefreshCw aria-hidden="true" />
						重试
					</button>
				</div>
			)}

			{expanded && groups.length > 0 && (
				<div className="graph-warning-details">
					{groups.map((group) => {
						const candidateSet = group.candidate_set_id
							? candidateSetById.get(group.candidate_set_id)
							: undefined;
						const canResolve = Boolean(
							onResolveWarning && candidateSet && isEditableResolution(group, candidateSet),
						);
						return (
							<article className="graph-warning-group" key={group.warning_id}>
								<header>
									<strong>{WARNING_LABELS[group.code]}</strong>
									<span>{group.severity === "error" ? "错误" : "提醒"}</span>
								</header>
								<p>{group.message}</p>
								{candidateSet && (
									<ul className="graph-warning-candidates">
										{candidateSet.candidates.map((candidate) => <li key={candidate}>{candidate}</li>)}
									</ul>
								)}
								<ul className="graph-warning-occurrences">
									{group.occurrences.map((occurrence) => (
										<li key={occurrence.occurrence_id}>
											<code>{occurrence.source_path}</code>
											<span>第 {occurrence.line} 行 · 第 {occurrence.column} 列</span>
										</li>
									))}
								</ul>
								{canResolve && candidateSet && (
									<button type="button" className="graph-warning-resolve" onClick={() => onResolveWarning?.(group, candidateSet)}>
										解决此告警
									</button>
								)}
							</article>
						);
					})}
					{nextCursor && !loading && !error && (
						<button type="button" className="graph-warning-more" onClick={() => void requestPage(nextCursor)}>
							加载更多
						</button>
					)}
				</div>
			)}
		</section>
	);
}

function isEditableResolution(
	group: GraphWarningGroupContract,
	candidateSet: GraphWarningCandidateSetContract,
): boolean {
	if (group.code !== "ambiguous_wikilink" && group.code !== "portable_path_collision") return false;
	if (candidateSet.candidates.length === 0) return false;
	if (group.occurrences.some((occurrence) => occurrence.read_only)) return false;
	return candidateSet.candidates.every((candidate) => (
		/^wiki\/(entities|topics|sources|comparisons|synthesis|queries)\/.+\.md$/.test(candidate)
	));
}

function migrationWarningText(warning: GraphMigrationWarningContract): string {
	if (warning.code === "legacy_semantic_edge_duplicate") {
		return "旧图谱中有重复关系，刷新时已按稳定顺序对齐；没有自动改写知识内容。";
	}
	const safePath = warning.source_path && isSafeRelativePath(warning.source_path)
		? `（${warning.source_path}）`
		: "";
	return `旧节点与新路径无法唯一对齐${safePath}，原固定位置已保留。`;
}

function isSafeRelativePath(value: string): boolean {
	return !value.startsWith("/") && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
}
