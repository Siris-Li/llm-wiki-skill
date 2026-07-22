import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { GraphData } from "@llm-wiki/graph-engine";
import { GraphReadDataSchema } from "@llm-wiki/workbench-contracts";

import { createApp } from "./app.js";
import {
	paginateGraphWarningContext,
	readGraphWarningContext,
} from "./graph-warnings.js";
import { GraphRebuildQueue } from "./graph.js";
import type { GraphRouteService } from "./routes/graph.js";

const require = createRequire(import.meta.url);
const { assembleGraphArtifactPair } = require("../../../scripts/lib/graph-warning-bundle.js") as {
	assembleGraphArtifactPair(input: {
		graphData: GraphData;
		groups: unknown[];
		candidateSets: unknown[];
		detailsRef?: string;
	}): { graphData: GraphData; warningBundle: Record<string, any> };
};

test("verified warning pairs paginate groups without repeating occurrences or candidate sets", async () => {
	const kbPath = await tempKb();
	try {
		const pair = makePair(5);
		const graphPath = await writePair(kbPath, pair);
		const scheduled: string[] = [];
		const context = await readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: pair.graphData,
			scheduleRebuild: (value) => scheduled.push(value),
		});
		assert.equal(context.publicState.details_status, "available");
		assert.deepEqual(scheduled, []);

		const pages = [];
		let cursor: string | undefined;
		do {
			const page = paginateGraphWarningContext(context, { limit: 2, cursor });
			assert.equal(page.details_status, "available");
			pages.push(page);
			cursor = page.next_cursor ?? undefined;
		} while (cursor);

		assert.deepEqual(pages.map((page) => page.groups.length), [2, 2, 1]);
		const publicWarningIds = pages.flatMap((page) => page.groups.map((group) => group.warning_id));
		assert.equal(new Set(publicWarningIds).size, 5);
		assert.equal(publicWarningIds.every((id) => /^warning-[a-f0-9]{16}$/.test(id)), true);
		assert.equal(new Set(pages.flatMap((page) => page.groups.flatMap((group) => group.occurrences.map((item) => item.occurrence_id)))).size, 5);
		for (const page of pages) {
			const referenced = page.groups.flatMap((group) => group.candidate_set_id ? [group.candidate_set_id] : []);
			assert.deepEqual(page.candidate_sets.map((set) => set.candidate_set_id), referenced);
		}
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("valid custom graph output follows its verified sibling warning reference", async () => {
	const kbPath = await tempKb();
	try {
		const pair = makePair(1, "generated/custom/graph-warnings.json");
		const graphPath = await writePair(kbPath, pair, "generated/custom");
		const context = await readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: pair.graphData,
			scheduleRebuild: () => assert.fail("valid pair must not rebuild"),
		});
		assert.equal(context.publicState.details_status, "available");
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("a cursor is build-bound and malformed cursors are invalid requests", async () => {
	const kbPath = await tempKb();
	try {
		const firstPair = makePair(3);
		const graphPath = await writePair(kbPath, firstPair);
		const firstContext = await readGraphWarningContext({ kbPath, graphPath, graphData: firstPair.graphData, scheduleRebuild: () => {} });
		const firstPage = paginateGraphWarningContext(firstContext, { limit: 1 });
		assert.equal(firstPage.details_status, "available");
		assert.ok(firstPage.next_cursor);

		const decoded = JSON.parse(Buffer.from(firstPage.next_cursor, "base64url").toString("utf8"));
		assert.deepEqual(decoded, { version: 1, build_id: firstPair.graphData.meta.warning_summary?.build_id, offset: 1 });

		const nextPair = makePair(2);
		nextPair.graphData.meta.wiki_title = "next build";
		const rebuiltPair = assembleGraphArtifactPair({
			graphData: nextPair.graphData,
			groups: nextPair.warningBundle.groups,
			candidateSets: nextPair.warningBundle.candidate_sets,
		});
		await writePair(kbPath, rebuiltPair);
		const nextContext = await readGraphWarningContext({ kbPath, graphPath, graphData: rebuiltPair.graphData, scheduleRebuild: () => {} });
		assert.deepEqual(paginateGraphWarningContext(nextContext, { limit: 1, cursor: firstPage.next_cursor }), {
			details_status: "unavailable",
			summary: rebuiltPair.graphData.meta.warning_summary,
			details_unavailable_reason: "stale_cursor",
		});

		for (const cursor of [
			"not-json",
			Buffer.from(JSON.stringify({ version: 2, build_id: "b".repeat(64), offset: 1 })).toString("base64url"),
			Buffer.from(JSON.stringify({ version: 1, build_id: rebuiltPair.graphData.meta.warning_summary?.build_id, offset: 999 })).toString("base64url"),
		]) {
			assert.throws(
				() => paginateGraphWarningContext(nextContext, { limit: 1, cursor }),
				(error: any) => error?.code === "INVALID_REQUEST",
			);
		}
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("unverified warning files keep the graph summary readable and schedule one rebuild", async (t) => {
	const cases: Array<{
		name: string;
		reason: "missing" | "invalid" | "build_id_mismatch" | "details_sha256_mismatch";
		mutate: (input: { kbPath: string; graphPath: string; warningPath: string; pair: ReturnType<typeof makePair> }) => Promise<void>;
	}> = [
		{ name: "missing", reason: "missing", mutate: async ({ warningPath }) => unlink(warningPath) },
		{ name: "malformed", reason: "invalid", mutate: async ({ warningPath }) => writeFile(warningPath, "{bad-json", "utf8") },
		{ name: "wrong build", reason: "build_id_mismatch", mutate: async ({ warningPath, pair }) => {
			pair.warningBundle.build_id = "c".repeat(64);
			await writeFile(warningPath, JSON.stringify(pair.warningBundle), "utf8");
		} },
		{ name: "digest tamper", reason: "details_sha256_mismatch", mutate: async ({ warningPath, pair }) => {
			pair.warningBundle.groups[0].message = "tampered outside data must not leak /Users/private";
			await writeFile(warningPath, JSON.stringify(pair.warningBundle), "utf8");
		} },
		{ name: "absolute details ref", reason: "invalid", mutate: async ({ graphPath, pair }) => {
			pair.graphData.meta.warning_summary!.details_ref = "/tmp/graph-warnings.json";
			await writeFile(graphPath, JSON.stringify(pair.graphData), "utf8");
		} },
		{ name: "drive-relative details ref", reason: "invalid", mutate: async ({ graphPath, pair }) => {
			pair.graphData.meta.warning_summary!.details_ref = "C:wiki/graph-warnings.json";
			await writeFile(graphPath, JSON.stringify(pair.graphData), "utf8");
		} },
		{ name: "escaping details ref", reason: "invalid", mutate: async ({ graphPath, pair }) => {
			pair.graphData.meta.warning_summary!.details_ref = "../graph-warnings.json";
			await writeFile(graphPath, JSON.stringify(pair.graphData), "utf8");
		} },
		{ name: "wrong basename", reason: "invalid", mutate: async ({ graphPath, pair }) => {
			pair.graphData.meta.warning_summary!.details_ref = "wiki/warnings.json";
			await writeFile(graphPath, JSON.stringify(pair.graphData), "utf8");
		} },
		{ name: "non sibling ref", reason: "invalid", mutate: async ({ kbPath, graphPath, warningPath, pair }) => {
			await mkdir(path.join(kbPath, "other"), { recursive: true });
			await writeFile(path.join(kbPath, "other", "graph-warnings.json"), await readFile(warningPath));
			pair.graphData.meta.warning_summary!.details_ref = "other/graph-warnings.json";
			await writeFile(graphPath, JSON.stringify(pair.graphData), "utf8");
		} },
		{ name: "sidecar symlink escape", reason: "invalid", mutate: async ({ kbPath, warningPath }) => {
			const outside = path.join(path.dirname(kbPath), `${path.basename(kbPath)}-outside.json`);
			await writeFile(outside, JSON.stringify({ secret: "/Users/private" }), "utf8");
			await unlink(warningPath);
			await symlink(outside, warningPath);
		} },
	];

	for (const testCase of cases) {
		await t.test(testCase.name, async () => {
			const kbPath = await tempKb();
			try {
				const pair = makePair(1);
				const graphPath = await writePair(kbPath, pair);
				const warningPath = path.join(kbPath, "wiki", "graph-warnings.json");
				await testCase.mutate({ kbPath, graphPath, warningPath, pair });
				const graphData = JSON.parse(await readFile(graphPath, "utf8")) as GraphData;
				const scheduled: string[] = [];
				const read = () => readGraphWarningContext({
					kbPath,
					graphPath,
					graphData,
					scheduleRebuild: (value) => scheduled.push(value),
				});
				const first = await read();
				const second = await read();
				assert.equal(first.publicState.details_status, "unavailable");
				assert.equal(first.publicState.details_unavailable_reason, testCase.reason);
				assert.deepEqual(second.publicState, first.publicState);
				assert.deepEqual(scheduled, [kbPath]);
				assert.equal(JSON.stringify(first).includes("/Users/private"), false);
			} finally {
				await rm(kbPath, { recursive: true, force: true });
			}
		});
	}
});

test("complete sidecar count mismatches stay readable but never return incomplete warning pages", async (t) => {
	const cases: Array<{
		name: string;
		createPair: () => ReturnType<typeof makePair>;
	}> = [
		{ name: "group occurrence count", createPair: makeIncompleteOccurrencePair },
		{ name: "summary group count", createPair: () => mutateSummaryCounts(makePair(2), (summary) => {
			summary.total_groups = 3;
		}) },
		{ name: "summary occurrence total", createPair: () => mutateSummaryCounts(makePair(2), (summary) => {
			summary.total_occurrences = 3;
			summary.error_occurrences = 3;
			summary.by_code.ambiguous_wikilink = 3;
		}) },
		{ name: "summary severity totals", createPair: () => mutateSummaryCounts(makePair(2), (summary) => {
			summary.error_occurrences = 1;
			summary.warning_occurrences = 1;
		}) },
		{ name: "summary code totals", createPair: () => mutateSummaryCounts(makePair(2), (summary) => {
			summary.by_code = { broken_wikilink: 2 };
		}) },
	];

	for (const testCase of cases) {
		await t.test(testCase.name, async () => {
			const kbPath = await tempKb();
			try {
				const pair = testCase.createPair();
				const graphPath = await writePair(kbPath, pair);
				const graphData = JSON.parse(await readFile(graphPath, "utf8")) as GraphData;
				const scheduled: string[] = [];
				const read = () => readGraphWarningContext({
					kbPath,
					graphPath,
					graphData,
					scheduleRebuild: (value) => scheduled.push(value),
				});
				const context = await read();
				await read();
				assert.equal(context.publicState.details_status, "unavailable");
				assert.equal(context.publicState.details_unavailable_reason, "invalid");
				assert.equal(context.bundle, null);
				assert.deepEqual(scheduled, [kbPath]);

				const app = createWarningContextApp(kbPath, graphData, context);
				const graphResponse = await app.request("/api/graph");
				assert.equal(graphResponse.status, 200);
				const graphPayload = await graphResponse.json() as any;
				assert.equal(graphPayload.data.state.status, "ready");
				assert.equal(graphPayload.data.needsBuild, false);
				assert.equal(graphPayload.data.warning_state.details_status, "unavailable");

				const warningResponse = await app.request("/api/graph/warnings");
				assert.equal(warningResponse.status, 200);
				const warningPayload = await warningResponse.json() as any;
				assert.equal(warningPayload.data.details_status, "unavailable");
				assert.equal("groups" in warningPayload.data, false);
				assert.equal("candidate_sets" in warningPayload.data, false);
			} finally {
				await rm(kbPath, { recursive: true, force: true });
			}
		});
	}
});

test("a checksum-valid sidecar with a cross-group duplicate occurrence stays unreadable and rebuilds once", async () => {
	const kbPath = await tempKb();
	try {
		const pair = resealCrossGroupDuplicateOccurrence(makePair(2));
		const graphPath = await writePair(kbPath, pair);
		const scheduled: string[] = [];
		const read = () => readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: pair.graphData,
			scheduleRebuild: (value) => scheduled.push(value),
		});
		const context = await read();
		await read();

		assert.equal(context.publicState.details_status, "unavailable");
		assert.equal(context.publicState.details_unavailable_reason, "invalid");
		assert.equal(context.bundle, null);
		assert.deepEqual(scheduled, [kbPath]);

		const app = createWarningContextApp(kbPath, pair.graphData, context);
		const graphResponse = await app.request("/api/graph");
		assert.equal(graphResponse.status, 200);
		const graphPayload = await graphResponse.json() as any;
		assert.equal(graphPayload.data.state.status, "ready");
		assert.equal(graphPayload.data.warning_state.details_status, "unavailable");
		const warningResponse = await app.request("/api/graph/warnings?limit=1");
		assert.equal(warningResponse.status, 200);
		const warningPayload = await warningResponse.json() as any;
		assert.equal(warningPayload.data.details_status, "unavailable");
		assert.equal("groups" in warningPayload.data, false);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("rebuild dedupe clears after authoritative recovery so the same build can heal twice", async () => {
	const kbPath = await tempKb();
	try {
		const pair = makePair(1);
		const graphPath = await writePair(kbPath, pair);
		const warningPath = path.join(kbPath, "wiki", "graph-warnings.json");
		const validWarningBytes = await readFile(warningPath);
		let scheduled = 0;
		const read = () => readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: pair.graphData,
			scheduleRebuild: () => { scheduled += 1; },
		});

		await writeFile(warningPath, "{damaged", "utf8");
		await read();
		await read();
		assert.equal(scheduled, 1);

		await writeFile(warningPath, validWarningBytes);
		assert.equal((await read()).publicState.details_status, "available");

		await writeFile(warningPath, "{damaged-again", "utf8");
		await read();
		await read();
		assert.equal(scheduled, 2);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("a rejected rebuild schedule is released so a later graph read retries", async () => {
	const kbPath = await tempKb();
	try {
		const pair = makePair(1);
		const graphPath = await writePair(kbPath, pair);
		await writeFile(path.join(kbPath, "wiki", "graph-warnings.json"), "{damaged", "utf8");
		let attempts = 0;
		const read = () => readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: pair.graphData,
			scheduleRebuild: async () => {
				attempts += 1;
				throw new Error("queue unavailable");
			},
		});

		await read();
		await new Promise((resolve) => setImmediate(resolve));
		await read();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(attempts, 2);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("a failed background rebuild releases dedupe while concurrent reads still share one attempt", async () => {
	const kbPath = await tempKb();
	try {
		const pair = makePair(1);
		const graphPath = await writePair(kbPath, pair);
		await writeFile(path.join(kbPath, "wiki", "graph-warnings.json"), "{damaged", "utf8");
		let attempts = 0;
		let scheduled = 0;
		let releaseRun!: () => void;
		const runGate = new Promise<void>((resolve) => { releaseRun = resolve; });
		const queue = new GraphRebuildQueue({
			run: async () => {
				attempts += 1;
				await runGate;
				throw new Error("background build failed");
			},
			onError: () => {},
		});
		const read = () => readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: pair.graphData,
			scheduleRebuild: (_value, options) => {
				scheduled += 1;
				return queue.trigger({ onFailure: options?.onFailure });
			},
		});

		await Promise.all([read(), read(), read()]);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(scheduled, 1);
		assert.equal(attempts, 1);

		releaseRun();
		await queue.waitForIdle();
		await read();
		await queue.waitForIdle();
		assert.equal(scheduled, 2);
		assert.equal(attempts, 2);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("warning API replaces untrusted sidecar messages while keeping safe relative paths readable", async () => {
	const kbPath = await tempKb();
	try {
		const malicious = "/Users/private · C:\\Users\\private · wiki\\private.md · portable-key:nfc|casefold · arbitrary raw text";
		const pair = makePair(1, "wiki/graph-warnings.json", () => malicious);
		pair.warningBundle.groups[0].warning_id = malicious;
		pair.warningBundle.groups[0].id = malicious;
		pair.warningBundle.groups[0].target_key = malicious;
		pair.warningBundle.groups[0].occurrences[0].occurrence_id = malicious;
		pair.warningBundle.groups[0].occurrences[0].raw_link = malicious;
		pair.warningBundle.candidate_sets[0].candidate_set_id = malicious;
		pair.warningBundle.groups[0].candidate_set_id = malicious;
		const resealed = resealPair(pair);
		const graphPath = await writePair(kbPath, pair);
		const context = await readGraphWarningContext({
			kbPath,
			graphPath,
			graphData: resealed.graphData,
			scheduleRebuild: () => assert.fail("valid pair must not rebuild"),
		});
		assert.equal(context.publicState.details_status, "available");
		const app = createWarningContextApp(kbPath, resealed.graphData, context);
		const response = await app.request("/api/graph/warnings");
		assert.equal(response.status, 200);
		const body = await response.text();
		for (const secret of ["/Users/private", "C:\\Users\\private", "wiki\\private.md", "portable-key:nfc|casefold", "arbitrary raw text"]) {
			assert.equal(body.includes(secret), false, secret);
		}
		for (const internalField of ["message", "target_key", "raw_link", "file_sha256", "start_byte", "end_byte"]) {
			assert.equal(body.includes(`\"${internalField}\"`), false, internalField);
		}
		assert.match(body, /wiki\/synthesis\/source-0\.md/);
		assert.match(body, /wiki\/entities\/foo-0\.md/);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("legacy graphs expose unavailable details while defensive engine warnings stay separate", async () => {
	const kbPath = await tempKb();
	try {
		const graphPath = path.join(kbPath, "wiki", "graph-data.json");
		const graphData = baseGraph();
		graphData.nodes.push({ ...graphData.nodes[0]!, label: "duplicate" });
		await mkdir(path.dirname(graphPath), { recursive: true });
		await writeFile(graphPath, JSON.stringify(graphData), "utf8");
		const context = await readGraphWarningContext({ kbPath, graphPath, graphData, scheduleRebuild: () => {} });
		assert.equal(context.publicState.details_unavailable_reason, "legacy_without_summary");
		assert.deepEqual(context.publicState.engine_groups.map((group) => group.code), ["duplicate_node_id"]);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

function makePair(
	groupCount: number,
	detailsRef = "wiki/graph-warnings.json",
	messageForIndex?: (index: number) => string,
) {
	const candidateSets = Array.from({ length: groupCount }, (_, index) => ({
		candidate_set_id: `candidate-${index}`,
		candidate_count: 2,
		candidates: [`wiki/entities/foo-${index}.md`, `wiki/topics/foo-${index}.md`],
	}));
	const groups = Array.from({ length: groupCount }, (_, index) => ({
		warning_id: `warning-${index}`,
		code: "ambiguous_wikilink",
		severity: "error",
		message: messageForIndex?.(index) ?? `Ambiguous ${index}`,
		target_key: `foo-${index}`,
		candidate_set_id: `candidate-${index}`,
		occurrence_count: 1,
		occurrences: [{
			occurrence_id: `occurrence-${index}`,
			source_path: `wiki/synthesis/source-${index}.md`,
			line: index + 1,
			column: 1,
			start_byte: index * 10,
			end_byte: index * 10 + 7,
			raw_link: `[[foo-${index}]]`,
			file_sha256: `${index.toString(16)}`.repeat(64),
			link_kind: "page_wikilink",
			read_only: false,
		}],
	}));
	return assembleGraphArtifactPair({ graphData: baseGraph(), groups, candidateSets, detailsRef });
}

function makeIncompleteOccurrencePair(): ReturnType<typeof makePair> {
	const pair = assembleGraphArtifactPair({
		graphData: baseGraph(),
		groups: [{
			warning_id: "warning-incomplete",
			code: "duplicate_node_id",
			severity: "error",
			message: "Duplicate input",
			id: "duplicate",
			occurrence_count: 1,
			occurrences: [{
				occurrence_id: "occurrence-only",
				source_path: "wiki/synthesis/source.md",
				line: 1,
				column: 1,
				start_byte: 0,
				end_byte: 7,
				raw_link: "[[foo]]",
				file_sha256: "a".repeat(64),
				link_kind: "page_wikilink",
				read_only: false,
			}],
		}],
		candidateSets: [],
	}) as ReturnType<typeof makePair>;
	pair.warningBundle.groups[0].occurrence_count = 2;
	mutateSummaryCounts(pair, (summary) => {
		summary.total_occurrences = 2;
		summary.error_occurrences = 2;
		summary.by_code.duplicate_node_id = 2;
	});
	return pair;
}

function resealCrossGroupDuplicateOccurrence(pair: ReturnType<typeof makePair>): ReturnType<typeof makePair> {
	pair.warningBundle.groups[1].occurrences[0].occurrence_id = pair.warningBundle.groups[0].occurrences[0].occurrence_id;
	return resealPair(pair);
}

function resealPair(pair: ReturnType<typeof makePair>): ReturnType<typeof makePair> {
	const graphWithoutSummary = structuredClone(pair.graphData) as Record<string, any>;
	delete graphWithoutSummary.meta.warning_summary;
	delete graphWithoutSummary.meta.build_date;
	const buildId = digest(canonicalBytes({
		graph_without_warning_summary: graphWithoutSummary,
		warning_details: {
			candidate_sets: pair.warningBundle.candidate_sets,
			groups: pair.warningBundle.groups,
		},
	}));
	pair.warningBundle.build_id = buildId;
	pair.warningBundle.summary.build_id = buildId;
	pair.graphData.meta.warning_summary!.build_id = buildId;
	const detailsSha256 = digest(canonicalBytes({
		version: 1,
		build_id: buildId,
		candidate_sets: pair.warningBundle.candidate_sets,
		groups: pair.warningBundle.groups,
	}));
	pair.warningBundle.summary.details_sha256 = detailsSha256;
	pair.graphData.meta.warning_summary!.details_sha256 = detailsSha256;
	return pair;
}

function canonicalBytes(value: unknown): Buffer {
	return Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
}

function canonicalize(value: any): any {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
		value[key] === undefined ? [] : [[key, canonicalize(value[key])]]
	)));
}

function digest(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function mutateSummaryCounts(
	pair: ReturnType<typeof makePair>,
	mutate: (summary: Record<string, any>) => void,
): ReturnType<typeof makePair> {
	mutate(pair.graphData.meta.warning_summary as Record<string, any>);
	mutate(pair.warningBundle.summary);
	return pair;
}

function createWarningContextApp(
	kbPath: string,
	graphData: GraphData,
	context: Awaited<ReturnType<typeof readGraphWarningContext>>,
) {
	const graphService: GraphRouteService = {
		getActiveKnowledgeBasePath: () => kbPath,
		assertRegisteredKnowledgeBase: async (requested) => requested,
		triggerGraphRebuild: () => ({ status: "started" }),
		readGraphData: async () => GraphReadDataSchema.parse({
			state: { status: "ready", rebuiltAt: null },
			needsBuild: false,
			data: graphData,
			warning_state: context.publicState,
		}),
		readGraphWarnings: async (_requested, query) => paginateGraphWarningContext(context, query),
		readGraphLayout: async () => ({ version: 2, pins: {}, updatedAt: "" }),
		writeGraphLayout: async (_requested, input) => ({ ...input, updatedAt: "" }),
	};
	return createApp({ graphService });
}

function baseGraph(): GraphData {
	return {
		meta: { build_date: "2026-07-20T00:00:00.000Z", wiki_title: "Warnings", total_nodes: 1, total_edges: 0 },
		nodes: [{ id: "wiki/topics/a.md", label: "A", type: "topic", source_path: "wiki/topics/a.md" }],
		edges: [],
	};
}

async function writePair(kbPath: string, pair: ReturnType<typeof makePair>, directory = "wiki"): Promise<string> {
	const output = path.join(kbPath, directory);
	await mkdir(output, { recursive: true });
	const graphPath = path.join(output, "graph-data.json");
	await writeFile(graphPath, JSON.stringify(pair.graphData), "utf8");
	await writeFile(path.join(output, "graph-warnings.json"), JSON.stringify(pair.warningBundle), "utf8");
	return graphPath;
}

async function tempKb(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-warnings-"));
}
