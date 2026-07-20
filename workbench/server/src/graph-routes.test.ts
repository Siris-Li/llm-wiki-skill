import assert from "node:assert/strict";
import test from "node:test";

import type {
	GraphLayoutData,
	GraphReadData,
	GraphRebuildData,
	GraphWarningPageContract,
} from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import type { GraphRouteService } from "./routes/graph.js";

const kbPath = "/fake/registered";
const graphData = {
	meta: {
		build_date: "2026-07-10T00:00:00.000Z",
		wiki_title: "测试知识库",
		total_nodes: 1,
		total_edges: 0,
	},
	nodes: [
		{
			id: "topic-a",
			label: "主题 A",
			type: "topic",
			source_path: "wiki/topics/a.md",
		},
	],
	edges: [],
};
const emptyLayout = { version: 2 as const, pins: {}, updatedAt: "" };
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
	details_status: "available" as const,
	details_unavailable_reason: null,
	engine_groups: [],
};

function createGraphService(
	overrides: Partial<GraphRouteService> = {},
): GraphRouteService {
	return {
		getActiveKnowledgeBasePath: () => kbPath,
		assertRegisteredKnowledgeBase: async (requested) => {
			if (requested === "/fake/private") {
				throw Object.assign(new Error("/Users/private/secret"), {
					code: "FORBIDDEN_PATH",
					details: { reason: "outside-root" },
				});
			}
			if (requested !== kbPath) {
				throw Object.assign(new Error("missing"), {
					code: "KB_NOT_REGISTERED",
				});
			}
			return requested;
		},
		triggerGraphRebuild: (): GraphRebuildData => ({ status: "started" }),
		readGraphData: async (): Promise<GraphReadData> => ({
			state: { status: "ready", rebuiltAt: null },
			needsBuild: false,
			data: graphData,
			warning_state: warningState,
		}),
		readGraphWarnings: async (): Promise<GraphWarningPageContract> => ({
			details_status: "available",
			build_id: warningSummary.build_id,
			summary: warningSummary,
			groups: [],
			candidate_sets: [],
			next_cursor: null,
		}),
		readGraphLayout: async (): Promise<GraphLayoutData> => emptyLayout,
		writeGraphLayout: async (_path, input): Promise<GraphLayoutData> => ({
			...emptyLayout,
			...input,
			updatedAt: "2026-07-10T00:00:00.000Z",
		}),
		...overrides,
	};
}

async function json(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

test("graph rebuild 返回统一任务状态并复用 active context", async () => {
	const triggered: string[] = [];
	const app = createApp({
		graphService: createGraphService({
			triggerGraphRebuild: (resolvedPath) => {
				triggered.push(resolvedPath);
				return { status: triggered.length === 1 ? "started" : "queued" };
			},
		}),
	});

	let res = await app.request("/api/graph/rebuild", { method: "POST" });
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), { ok: true, data: { status: "started" } });

	res = await app.request("/api/graph/rebuild", { method: "POST" });
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), { ok: true, data: { status: "queued" } });
	assert.deepEqual(triggered, [kbPath, kbPath]);
});

test("graph rebuild 并发 BUSY 与触发失败返回稳定 failure envelope", async () => {
	let app = createApp({
		graphService: createGraphService({
			triggerGraphRebuild: () => {
				throw Object.assign(new Error("already running /Users/private"), {
					code: "BUSY",
				});
			},
		}),
	});
	let res = await app.request("/api/graph/rebuild", { method: "POST" });
	assert.equal(res.status, 409);
	assert.deepEqual(await json(res), {
		ok: false,
		code: "BUSY",
		message: "图谱正在重建",
	});

	app = createApp({
		graphService: createGraphService({
			triggerGraphRebuild: () => {
				throw new Error("spawn failed /Users/private/build.sh");
			},
		}),
	});
	res = await app.request("/api/graph/rebuild", { method: "POST" });
	assert.equal(res.status, 500);
	const failure = await json(res);
	assert.equal(failure.code, "INTERNAL_ERROR");
	assert.equal(JSON.stringify(failure).includes("/Users/"), false);
});

test("graph rebuild 拒绝 no active KB 与 forbidden path，且不会触发任务", async () => {
	let calls = 0;
	let app = createApp({
		graphService: createGraphService({
			getActiveKnowledgeBasePath: () => null,
			triggerGraphRebuild: () => {
				calls++;
				return { status: "started" };
			},
		}),
	});
	let res = await app.request("/api/graph/rebuild", { method: "POST" });
	assert.equal(res.status, 400);
	assert.equal((await json(res)).code, "NO_ACTIVE_KB");

	app = createApp({
		graphService: createGraphService({
			triggerGraphRebuild: () => {
				calls++;
				return { status: "started" };
			},
		}),
	});
	res = await app.request("/api/graph/rebuild?kb=%2Ffake%2Fprivate", {
		method: "POST",
	});
	assert.equal(res.status, 403);
	const payload = await json(res);
	assert.equal(payload.code, "FORBIDDEN_PATH");
	assert.equal(JSON.stringify(payload).includes("/Users/"), false);
	assert.equal(calls, 0);
});


test("graph read 与 layout read/save 返回统一 success envelope", async () => {
	const writes: Array<{ kbPath: string; input: unknown }> = [];
	const app = createApp({
		graphService: createGraphService({
			writeGraphLayout: async (resolvedPath, input) => {
				writes.push({ kbPath: resolvedPath, input });
				return {
					version: 2,
					pins: input.pins,
					updatedAt: "2026-07-10T00:00:00.000Z",
				};
			},
		}),
	});

	const graph = await app.request("/api/graph");
	assert.equal(graph.status, 200);
	assert.deepEqual(await json(graph), {
		ok: true,
		data: {
			state: { status: "ready", rebuiltAt: null },
			needsBuild: false,
			data: graphData,
			warning_state: warningState,
		},
	});

	const layout = await app.request("/api/graph/layout");
	assert.equal(layout.status, 200);
	assert.deepEqual(await json(layout), {
		ok: true,
		data: emptyLayout,
	});

	const saved = await app.request("/api/graph/layout", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			kbPath,
			version: 2,
			pins: { "wiki/topics/a.md": { x: 1, y: 2 } },
		}),
	});
	assert.equal(saved.status, 200);
	assert.equal((await json(saved)).ok, true);
	assert.deepEqual(writes, [
		{
			kbPath,
			input: {
				version: 2,
				pins: { "wiki/topics/a.md": { x: 1, y: 2 } },
			},
		},
	]);
});

test("graph warnings route parses pagination and supports active or explicit registered KB", async () => {
	const calls: Array<{ kbPath: string; query: unknown }> = [];
	const page: GraphWarningPageContract = {
		details_status: "available",
		build_id: warningSummary.build_id,
		summary: warningSummary,
		groups: [],
		candidate_sets: [],
		next_cursor: "next-cursor",
	};
	const app = createApp({
		graphService: createGraphService({
			assertRegisteredKnowledgeBase: async (requested) => requested,
			readGraphWarnings: async (resolvedPath, query) => {
				calls.push({ kbPath: resolvedPath, query });
				return page;
			},
		}),
	});

	let res = await app.request("/api/graph/warnings?limit=1&cursor=opaque-cursor");
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), { ok: true, data: page });

	const explicit = "/fake/explicit";
	res = await app.request(`/api/graph/warnings?kb=${encodeURIComponent(explicit)}&limit=100`);
	assert.equal(res.status, 200);
	assert.deepEqual(calls, [
		{ kbPath, query: { limit: 1, cursor: "opaque-cursor" } },
		{ kbPath: explicit, query: { limit: 100 } },
	]);
});

test("graph warning data failures remain success responses while invalid requests are rejected", async () => {
	const unavailable: GraphWarningPageContract = {
		details_status: "unavailable",
		summary: warningSummary,
		details_unavailable_reason: "details_sha256_mismatch",
	};
	let calls = 0;
	const app = createApp({
		graphService: createGraphService({
			readGraphWarnings: async () => {
				calls++;
				return unavailable;
			},
		}),
	});

	let res = await app.request("/api/graph/warnings");
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), { ok: true, data: unavailable });

	for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=oops"]) {
		res = await app.request(`/api/graph/warnings?${query}`);
		assert.equal(res.status, 400, query);
		assert.equal((await json(res)).code, "INVALID_REQUEST", query);
	}
	assert.equal(calls, 1);
});

test("graph with error-level data warnings stays readable and keeps full details out of graph GET", async () => {
	const app = createApp({ graphService: createGraphService() });
	const res = await app.request("/api/graph");
	assert.equal(res.status, 200);
	const payload = await json(res) as any;
	assert.equal(payload.data.state.status, "ready");
	assert.equal(payload.data.needsBuild, false);
	assert.equal(payload.data.warning_state.summary.error_occurrences, 1);
	assert.equal("groups" in payload.data.warning_state, false);
	assert.equal("candidate_sets" in payload.data.warning_state, false);
});

test("graph read returns the saved safe error as authoritative state", async () => {
	const app = createApp({
		graphService: createGraphService({
			readGraphData: async () => ({
				state: {
					status: "error",
					message: "图谱重建失败",
					rebuiltAt: "2026-07-15T12:00:00.000Z",
				},
			}),
		}),
	});

	const res = await app.request("/api/graph");
	assert.equal(res.status, 200);
	assert.deepEqual(await json(res), {
		ok: true,
		data: {
			state: {
				status: "error",
				message: "图谱重建失败",
				rebuiltAt: "2026-07-15T12:00:00.000Z",
			},
		},
	});
});

test("layout PUT 的 query kb 优先于 body kbPath", async () => {
	const writes: string[] = [];
	const queryKb = "/fake/query";
	const app = createApp({
		graphService: createGraphService({
			assertRegisteredKnowledgeBase: async (requested) => requested,
			writeGraphLayout: async (resolvedPath, input) => {
				writes.push(resolvedPath);
				return { version: 2, pins: input.pins, updatedAt: "now" };
			},
		}),
	});
	const res = await app.request(
		`/api/graph/layout?kb=${encodeURIComponent(queryKb)}`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kbPath: "/fake/body",
				version: 2,
				pins: {},
			}),
		},
	);
	assert.equal(res.status, 200);
	assert.deepEqual(writes, [queryKb]);
});

test("graph route 复用 active context 的 no active 与 registered KB 错误语义", async () => {
	let app = createApp({
		graphService: createGraphService({ getActiveKnowledgeBasePath: () => null }),
	});
	let res = await app.request("/api/graph");
	assert.equal(res.status, 400);
	assert.equal((await json(res)).code, "NO_ACTIVE_KB");

	app = createApp({ graphService: createGraphService() });
	res = await app.request("/api/graph/layout?kb=%2Ffake%2Funregistered");
	assert.equal(res.status, 404);
	assert.equal((await json(res)).code, "KB_NOT_REGISTERED");

	res = await app.request("/api/graph?kb=%2Ffake%2Fprivate");
	assert.equal(res.status, 403);
	const payload = await json(res);
	assert.deepEqual(payload, {
		ok: false,
		code: "FORBIDDEN_PATH",
		message: "路径不在允许的知识库边界内",
		details: { reason: "outside-root" },
	});
	assert.equal(JSON.stringify(payload).includes("/Users/"), false);
});

test("graph not found 与 layout schema mismatch 返回稳定 failure envelope", async () => {
	let app = createApp({
		graphService: createGraphService({
			readGraphData: async () => {
				throw Object.assign(new Error("ENOENT /Users/private/graph-data.json"), {
					code: "ENOENT",
				});
			},
		}),
	});
	let res = await app.request("/api/graph");
	assert.equal(res.status, 404);
	assert.deepEqual(await json(res), {
		ok: false,
		code: "NOT_FOUND",
		message: "图谱数据不存在",
	});

	app = createApp({ graphService: createGraphService() });
	res = await app.request("/api/graph/layout", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ kbPath, version: 2, pins: { "wiki/a.md": { x: "bad", y: 2 } } }),
	});
	assert.equal(res.status, 400);
	assert.equal((await json(res)).code, "INVALID_REQUEST");
});

test("graph service response schema mismatch 由统一兜底拒绝", async () => {
	const app = createApp({
		mode: "test",
		graphService: createGraphService({
			readGraphLayout: async () =>
				({ version: 2, pins: "bad", updatedAt: "" }) as never,
		}),
	});
	const res = await app.request("/api/graph/layout");
	assert.equal(res.status, 500);
	assert.equal((await json(res)).code, "INTERNAL_ERROR");
});
