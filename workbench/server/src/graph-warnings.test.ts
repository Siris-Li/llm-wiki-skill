import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { GraphData } from "@llm-wiki/graph-engine";

import {
	paginateGraphWarningContext,
	readGraphWarningContext,
} from "./graph-warnings.js";

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
		assert.deepEqual(
			pages.flatMap((page) => page.groups.map((group) => group.warning_id)),
			["warning-0", "warning-1", "warning-2", "warning-3", "warning-4"],
		);
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

function makePair(groupCount: number, detailsRef = "wiki/graph-warnings.json") {
	const candidateSets = Array.from({ length: groupCount }, (_, index) => ({
		candidate_set_id: `candidate-${index}`,
		candidate_count: 2,
		candidates: [`wiki/entities/foo-${index}.md`, `wiki/topics/foo-${index}.md`],
	}));
	const groups = Array.from({ length: groupCount }, (_, index) => ({
		warning_id: `warning-${index}`,
		code: "ambiguous_wikilink",
		severity: "error",
		message: `Ambiguous ${index}`,
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
