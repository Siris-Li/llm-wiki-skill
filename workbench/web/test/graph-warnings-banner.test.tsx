import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";

import type {
	GraphMigrationWarningContract,
	GraphWarningCandidateSetContract,
	GraphWarningGroupContract,
	GraphWarningPageContract,
	GraphWarningSummaryContract,
	GraphWarningStateContract,
} from "@llm-wiki/workbench-contracts";

import { GraphWarningsBanner } from "../src/components/GraphWarningsBanner";
import { click, render, screen, waitFor } from "./render";

const summary = {
	build_id: "b".repeat(64),
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
	details_sha256: "d".repeat(64),
} as const;

const engineGroup: GraphWarningGroupContract = {
	warning_id: "engine-duplicate",
	code: "duplicate_node_id",
	severity: "error",
	message: "duplicate input",
	id: "opaque-node-id",
	occurrence_count: 0,
	occurrences: [],
};

const warningState: GraphWarningStateContract = {
	summary,
	details_status: "available",
	details_unavailable_reason: null,
	engine_groups: [engineGroup],
};

describe("GraphWarningsBanner", () => {
	it("shows all warning meanings and loads every page only on demand", async () => {
		const calls: Array<string | undefined> = [];
		const pages = [
			page("warning-first", "ambiguous_wikilink", "candidate-shared", "wiki/synthesis/first.md", "cursor-2"),
			page("warning-middle", "portable_path_collision", "candidate-shared", "wiki/synthesis/middle.md", "cursor-3"),
			page("warning-last", "broken_wikilink", undefined, "wiki/synthesis/last.md", null),
		];
		render(
			<GraphWarningsBanner
				warningState={warningState}
				loadPage={async (cursor) => {
					calls.push(cursor);
					return pages[calls.length - 1]!;
				}}
			/>,
		);

		assert.match(screen.getByRole("region", { name: "图谱告警" }).textContent ?? "", /6 个错误.*3 个提醒/);
		for (const label of ["节点 ID 重复", "关系 ID 重复", "社区 ID 重复", "自动 ID 冲突", "链接目标有歧义", "链接目标不存在", "链接目标待创建", "链接写法不规范", "路径在其他系统可能冲突"]) {
			assert.ok(screen.queryAllByText(label).length > 0, label);
		}
		assert.deepEqual(calls, []);

		const details = screen.getByRole("button", { name: "查看详情" });
		assert.equal(details.getAttribute("aria-expanded"), "false");
		await click(details);
		await waitFor(() => assert.deepEqual(calls, [undefined]));
		assert.equal(details.getAttribute("aria-expanded"), "true");
		assert.match(document.body.textContent ?? "", /wiki\/synthesis\/first\.md.*第 1 行.*第 2 列/);
		assert.equal(document.body.textContent?.match(/wiki\/entities\/candidate-shared\.md/g)?.length, 1);

		await click(screen.getByRole("button", { name: "加载更多" }));
		await waitFor(() => assert.deepEqual(calls, [undefined, "cursor-2"]));
		await click(screen.getByRole("button", { name: "加载更多" }));
		await waitFor(() => assert.deepEqual(calls, [undefined, "cursor-2", "cursor-3"]));
		assert.equal(screen.queryByRole("button", { name: "加载更多" }), null);
		assert.match(document.body.textContent ?? "", /wiki\/synthesis\/last\.md/);
		assert.equal(document.body.textContent?.match(/wiki\/entities\/candidate-shared\.md/g)?.length, 1);
	});

	it("keeps summary counts when details are unavailable", () => {
		render(<GraphWarningsBanner warningState={{
			summary,
			details_status: "unavailable",
			details_unavailable_reason: "details_sha256_mismatch",
			engine_groups: [],
		}} loadPage={async () => assert.fail("unavailable details must not load")} />);
		assert.match(document.body.textContent ?? "", /6 个错误.*3 个提醒/);
		assert.match(document.body.textContent ?? "", /详情暂不可用.*已安排重新构建/);
		assert.equal(screen.queryByRole("button", { name: "查看详情" }), null);
	});

	it("drops loaded detail pages when their build becomes unavailable", async () => {
		const { rerender } = render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => page("warning-old", "broken_wikilink", undefined, "wiki/synthesis/old.md", null)}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /wiki\/synthesis\/old\.md/));

		rerender(<GraphWarningsBanner
			warningState={{
				...warningState,
				details_status: "unavailable",
				details_unavailable_reason: "details_sha256_mismatch",
			}}
			loadPage={async () => assert.fail("unavailable details must not load")}
		/>);

		assert.doesNotMatch(document.body.textContent ?? "", /wiki\/synthesis\/old\.md/);
		assert.match(document.body.textContent ?? "", /详情暂不可用/);
	});

	it("does not show a first page that arrives after the warning build changes", async () => {
		const oldRequest = deferred<GraphWarningPageContract>();
		const nextSummary = {
			...summary,
			build_id: "c".repeat(64),
			details_sha256: "e".repeat(64),
		};
		const { rerender } = render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={() => oldRequest.promise}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));

		rerender(<GraphWarningsBanner
			warningState={{ ...warningState, summary: nextSummary }}
			loadPage={async () => pageForSummary(nextSummary, "warning-new", "broken_wikilink", "wiki/synthesis/new.md", null)}
		/>);
		oldRequest.resolve(page("warning-old", "broken_wikilink", undefined, "wiki/synthesis/old.md", null));
		await waitFor(() => assert.equal(screen.getByRole("button", { name: "查看详情" }).getAttribute("aria-expanded"), "false"));

		assert.doesNotMatch(document.body.textContent ?? "", /wiki\/synthesis\/old\.md/);
	});

	it("clears loaded details when state becomes unavailable during load-more and ignores its late response", async () => {
		const nextRequest = deferred<GraphWarningPageContract>();
		let calls = 0;
		const { rerender } = render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => {
				calls++;
				if (calls === 1) return page("warning-first", "broken_wikilink", undefined, "wiki/synthesis/first.md", "cursor-2");
				return nextRequest.promise;
			}}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /wiki\/synthesis\/first\.md/));
		await click(screen.getByRole("button", { name: "加载更多" }));

		rerender(<GraphWarningsBanner
			warningState={{
				...warningState,
				details_status: "unavailable",
				details_unavailable_reason: "details_sha256_mismatch",
			}}
			loadPage={async () => assert.fail("unavailable details must not load")}
		/>);
		assert.doesNotMatch(document.body.textContent ?? "", /wiki\/synthesis\/first\.md/);
		nextRequest.resolve(page("warning-late", "broken_wikilink", undefined, "wiki/synthesis/late.md", null));
		await waitFor(() => assert.match(document.body.textContent ?? "", /详情暂不可用/));

		assert.doesNotMatch(document.body.textContent ?? "", /wiki\/synthesis\/(first|late)\.md/);
	});

	it("clears loaded details when load-more returns an unavailable page", async () => {
		let calls = 0;
		render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => {
				calls++;
				if (calls === 1) return page("warning-first", "broken_wikilink", undefined, "wiki/synthesis/first.md", "cursor-2");
				return {
					details_status: "unavailable",
					summary,
					details_unavailable_reason: "details_sha256_mismatch",
				};
			}}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /wiki\/synthesis\/first\.md/));
		await click(screen.getByRole("button", { name: "加载更多" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /详情暂不可用/));

		assert.doesNotMatch(document.body.textContent ?? "", /wiki\/synthesis\/first\.md/);
	});

	it("rejects a page not bound to the current build and details digest", async () => {
		const mismatchedSummary = { ...summary, details_sha256: "e".repeat(64) };
		render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => pageForSummary(mismatchedSummary, "warning-tampered", "broken_wikilink", "wiki/synthesis/tampered.md", null)}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /详情暂不可用/));

		assert.doesNotMatch(document.body.textContent ?? "", /wiki\/synthesis\/tampered\.md/);
	});

	it("keeps loaded details through an ordinary same-build refresh", async () => {
		const { rerender } = render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => page("warning-read", "broken_wikilink", undefined, "wiki/synthesis/read.md", null)}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /wiki\/synthesis\/read\.md/));

		rerender(<GraphWarningsBanner
			warningState={{ ...warningState, engine_groups: [...warningState.engine_groups] }}
			loadPage={async () => assert.fail("same-build refresh must preserve the loaded page")}
		/>);

		assert.match(document.body.textContent ?? "", /wiki\/synthesis\/read\.md/);
		assert.equal(screen.getByRole("button", { name: "查看详情" }).getAttribute("aria-expanded"), "true");
	});

	it("shows every defensive input warning with its type and explanation but no write action", () => {
		const defensiveGroups: GraphWarningGroupContract[] = [{
			...engineGroup,
			message: "节点 ID opaque-node-id 在输入中出现两次，请检查来源。",
		}, {
			warning_id: "engine-edge-duplicate",
			code: "duplicate_edge_id",
			severity: "error",
			message: "关系 ID opaque-edge-id 在输入中重复；这里只说明问题，不会改写知识库。",
			id: "opaque-edge-id",
			occurrence_count: 0,
			occurrences: [],
		}];
		let resolveCalls = 0;
		render(<GraphWarningsBanner
			warningState={{ ...warningState, engine_groups: defensiveGroups }}
			loadPage={async () => assert.fail("input warnings are available without loading persisted details")}
			onResolveWarning={() => resolveCalls++}
		/>);

		const explanations = screen.getByRole("note", { name: "输入检查说明" });
		assert.match(explanations.textContent ?? "", /节点 ID 重复.*节点 ID opaque-node-id 在输入中出现两次/);
		assert.match(explanations.textContent ?? "", /关系 ID 重复.*关系 ID opaque-edge-id 在输入中重复/);
		assert.equal(explanations.querySelectorAll("li").length, 2);
		assert.equal(screen.queryByRole("button", { name: /解决|改名/ }), null);
		assert.equal(resolveCalls, 0);
	});

	it("shows migration notices without leaking paths and dismisses them independently", async () => {
		const migrationWarnings: GraphMigrationWarningContract[] = [{
			code: "identity_alignment_ambiguous",
			source_path: "/Users/private/wiki/foo.md",
			previous_ids: ["old"],
			next_ids: ["next"],
		}, {
			code: "legacy_semantic_edge_duplicate",
			semantic_key: '["opaque-a","opaque-b","依赖"]',
			previous_edge_ids: ["old-edge"],
			next_edge_ids: ["next-edge"],
		}];
		let dismissed = 0;
		render(<GraphWarningsBanner
			warningState={warningState}
			migrationWarnings={migrationWarnings}
			onDismissMigrationWarnings={() => dismissed++}
			loadPage={async () => assert.fail("not expanded")}
		/>);
		assert.match(document.body.textContent ?? "", /首次刷新有 2 项迁移提示/);
		assert.equal(document.body.textContent?.includes("/Users/private"), false);
		assert.equal(screen.queryByText("解决"), null);
		await click(screen.getByRole("button", { name: "关闭迁移提示" }));
		assert.equal(dismissed, 1);
		assert.doesNotMatch(document.body.textContent ?? "", /首次刷新有 2 项迁移提示/);
		assert.match(document.body.textContent ?? "", /6 个错误/);
	});

	it("only offers resolution for editable formal candidates when a callback exists", async () => {
		const candidateSet: GraphWarningCandidateSetContract = {
			candidate_set_id: "candidate-first",
			candidate_count: 2,
			candidates: ["wiki/entities/candidate-first.md", "wiki/topics/candidate-first.md"],
		};
		const sourcePage = page("warning-first", "ambiguous_wikilink", candidateSet.candidate_set_id, "wiki/synthesis/first.md", null);
		const calls: unknown[] = [];
		render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => sourcePage}
			onResolveWarning={(group, candidates) => calls.push([group, candidates])}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.notEqual(screen.queryByRole("button", { name: "解决此告警" }), null));
		await click(screen.getByRole("button", { name: "解决此告警" }));
		assert.deepEqual(calls, [[sourcePage.groups[0], sourcePage.candidate_sets[0]]]);
	});

	it("announces loading and supports retry after a page error", async () => {
		let attempts = 0;
		render(<GraphWarningsBanner
			warningState={warningState}
			loadPage={async () => {
				attempts++;
				if (attempts === 1) throw new Error("temporary failure");
				return page("warning-first", "broken_wikilink", undefined, "wiki/synthesis/retry.md", null);
			}}
		/>);
		await click(screen.getByRole("button", { name: "查看详情" }));
		await waitFor(() => assert.notEqual(screen.queryByRole("alert"), null));
		assert.match(screen.getByRole("alert").textContent ?? "", /详情加载失败/);
		await click(screen.getByRole("button", { name: "重试" }));
		await waitFor(() => assert.match(document.body.textContent ?? "", /wiki\/synthesis\/retry\.md/));
		assert.equal(attempts, 2);
		assert.equal(screen.getByRole("status").getAttribute("aria-live"), "polite");
	});
});

function page(
	warningId: string,
	code: GraphWarningGroupContract["code"],
	candidateSetId: string | undefined,
	sourcePath: string,
	nextCursor: string | null,
): Extract<GraphWarningPageContract, { details_status: "available" }> {
	return pageForSummary(summary, warningId, code, sourcePath, nextCursor, candidateSetId);
}

function pageForSummary(
	pageSummary: GraphWarningSummaryContract,
	warningId: string,
	code: GraphWarningGroupContract["code"],
	sourcePath: string,
	nextCursor: string | null,
	candidateSetId?: string,
): Extract<GraphWarningPageContract, { details_status: "available" }> {
	const candidateSets = candidateSetId ? [{
		candidate_set_id: candidateSetId,
		candidate_count: 2,
		candidates: [`wiki/entities/${candidateSetId}.md`, `wiki/topics/${candidateSetId}.md`],
	}] : [];
	return {
		details_status: "available",
		build_id: pageSummary.build_id,
		summary: pageSummary,
		groups: [{
			warning_id: warningId,
			code,
			severity: "error",
			message: warningId,
			...(candidateSetId ? { candidate_set_id: candidateSetId } : {}),
			occurrence_count: 1,
			occurrences: [{
				occurrence_id: `${warningId}-occurrence`,
				source_path: sourcePath,
				line: 1,
				column: 2,
				start_byte: 0,
				end_byte: 7,
				raw_link: "[[target]]",
				file_sha256: "a".repeat(64),
				link_kind: "page_wikilink",
				read_only: false,
			}],
		}],
		candidate_sets: candidateSets,
		next_cursor: nextCursor,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}
