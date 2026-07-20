import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ApiError, ContractMismatchError } from "../src/lib/api/client";
import { getGraphData, getGraphLayout, getGraphWarnings, putGraphLayout, rebuildGraph } from "../src/lib/api/graph";

const warningSummary = {
	build_id: "b".repeat(64),
	total_groups: 1,
	total_occurrences: 1,
	error_occurrences: 1,
	warning_occurrences: 0,
	by_code: { broken_wikilink: 1 },
	details_ref: "wiki/graph-warnings.json",
	details_sha256: "d".repeat(64),
};

const warningState = {
	summary: warningSummary,
	details_status: "available",
	details_unavailable_reason: null,
	engine_groups: [],
};

function stubFetch(body: unknown, status = 200) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = ((input: URL | string, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}) as typeof globalThis.fetch;
	return calls;
}

describe("graph API module", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("graph read 与 layout read/save 通过 migrated JSON client", async () => {
		let calls = stubFetch({
			ok: true,
			data: {
				state: { status: "ready", rebuiltAt: null },
				needsBuild: true,
			},
		});
		assert.equal((await getGraphData("/kb/registered")).needsBuild, true);
		assert.equal(calls[0]?.url, "/api/graph?kb=%2Fkb%2Fregistered");

		calls = stubFetch({
			ok: true,
			data: { version: 2, pins: {}, updatedAt: "" },
		});
		assert.deepEqual((await getGraphLayout("/kb/registered")).pins, {});
		assert.equal(calls[0]?.url, "/api/graph/layout?kb=%2Fkb%2Fregistered");

		calls = stubFetch({
			ok: true,
			data: { version: 2, pins: {}, updatedAt: "2026-07-10T00:00:00.000Z" },
		});
		await putGraphLayout("/kb/registered", {
			"wiki/topics/a.md": { x: 1, y: 2 },
		});
		assert.equal(calls[0]?.url, "/api/graph/layout");
		assert.equal(calls[0]?.init?.method, "PUT");
		assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
			kbPath: "/kb/registered",
			version: 2,
			pins: { "wiki/topics/a.md": { x: 1, y: 2 } },
		});
	});

	it("graph rebuild 通过 migrated JSON client 返回异步任务状态", async () => {
		const calls = stubFetch({ ok: true, data: { status: "queued" } });
		assert.equal(await rebuildGraph("/kb/registered"), "queued");
		assert.equal(calls[0]?.url, "/api/graph/rebuild?kb=%2Fkb%2Fregistered");
		assert.equal(calls[0]?.init?.method, "POST");
	});

	it("graph read parses warning state and warning pages send exact pagination queries", async () => {
		const graphCalls = stubFetch({
			ok: true,
			data: {
				state: { status: "ready", rebuiltAt: null },
				needsBuild: false,
				data: {
					meta: { build_date: "now", wiki_title: "KB", total_nodes: 0, total_edges: 0, warning_summary: warningSummary },
					nodes: [],
					edges: [],
				},
				warning_state: warningState,
			},
		});
		const graph = await getGraphData("/kb/registered");
		assert.equal(graphCalls[0]?.url, "/api/graph?kb=%2Fkb%2Fregistered");
		assert.equal(graph.state.status, "ready");
		assert.equal("warning_state" in graph && graph.warning_state.details_status, "available");

		const page = {
			details_status: "available",
			build_id: warningSummary.build_id,
			summary: warningSummary,
			groups: [],
			candidate_sets: [],
			next_cursor: "next",
		};
		const warningCalls = stubFetch({ ok: true, data: page });
		assert.deepEqual(await getGraphWarnings("/kb/registered", "opaque-cursor", 7), page);
		assert.equal(warningCalls[0]?.url, "/api/graph/warnings?kb=%2Fkb%2Fregistered&cursor=opaque-cursor&limit=7");

		const unavailable = {
			details_status: "unavailable",
			summary: warningSummary,
			details_unavailable_reason: "missing",
		};
		stubFetch({ ok: true, data: unavailable });
		assert.deepEqual(await getGraphWarnings("/kb/registered"), unavailable);
	});

	it("warning page parsing rejects leaked absolute content paths", async () => {
		stubFetch({
			ok: true,
			data: {
				details_status: "available",
				build_id: warningSummary.build_id,
				summary: warningSummary,
				groups: [{
					warning_id: "broken",
					code: "broken_wikilink",
					severity: "error",
					message: "broken",
					occurrence_count: 1,
					occurrences: [{
						occurrence_id: "occ",
						source_path: "/Users/private/wiki/a.md",
						line: 1,
						column: 1,
						start_byte: 0,
						end_byte: 1,
						raw_link: "[[x]]",
						file_sha256: "a".repeat(64),
						link_kind: "page_wikilink",
						read_only: false,
					}],
				}],
				candidate_sets: [],
				next_cursor: null,
			},
		});
		await assert.rejects(
			() => getGraphWarnings("/kb/registered"),
			(error) => error instanceof ContractMismatchError,
		);
	});

	it("rebuild 透出 BUSY code，并拒绝旧响应格式", async () => {
		stubFetch({ ok: false, code: "BUSY", message: "图谱正在重建" }, 409);
		await assert.rejects(
			() => rebuildGraph("/kb/registered"),
			(err) => err instanceof ApiError && err.code === "BUSY",
		);

		stubFetch({ ok: true, status: "started" });
		await assert.rejects(
			() => rebuildGraph("/kb/registered"),
			(err) => err instanceof ContractMismatchError,
		);
	});

	it("统一错误透出 code，响应 schema mismatch 被拒绝", async () => {
		stubFetch({ ok: false, code: "NO_ACTIVE_KB", message: "当前没有选择知识库" }, 400);
		await assert.rejects(
			() => getGraphData(""),
			(err) => err instanceof ApiError && err.code === "NO_ACTIVE_KB",
		);

		stubFetch({ ok: true, data: { needsBuild: false, graphPath: "/kb/graph.json" } });
		await assert.rejects(
			() => getGraphData("/kb/registered"),
			(err) => err instanceof ContractMismatchError,
		);
	});
});
