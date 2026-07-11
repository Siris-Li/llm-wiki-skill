import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkWorkbenchBoundaries } from "./check-workbench-boundaries.mjs";

async function fixture(files) {
	const root = await mkdtemp(path.join(os.tmpdir(), "workbench-boundaries-"));
	for (const [relativePath, content] of Object.entries(files)) {
		const target = path.join(root, relativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
	return root;
}

test("reports every forbidden workbench contract boundary", async (t) => {
	const root = await fixture({
		"workbench/web/src/components/Bad.tsx": [
			'fetch("/api/health");',
		].join("\n"),
		"workbench/web/test/bad.test.ts":
			'import { createApp } from "../../server/src/app";',
		"workbench/web/vite.config.ts":
			'import { HealthDataSchema } from "@llm-wiki/workbench-contracts/health";',
		"workbench/web/src/lib/api/domain.ts": [
			'const payload = (await response.json()) as { ok: boolean; items?: unknown[]; error?: string };',
			"export default payload.items ?? [];",
		].join("\n"),
		"workbench/web/src/lib/api.ts":
			'export * from "./api/health";',
		"workbench/web/src/lib/api/legacy.ts": [
			'const response = await fetch("/api/health");',
			'const json = (await response.json()) as { ok: boolean; error?: string };',
		].join("\n"),
		"workbench/server/src/routes/bad.ts":
			'return c.json({ ok: false, error: "broken" }, 400);',
		"packages/workbench-contracts/src/bad.ts": [
			'import { Hono } from "hono";',
			'import { readFile } from "node:fs/promises";',
		].join("\n"),
		"packages/workbench-contracts/src/endpoints.ts": [
			'export const ENDPOINT_REGISTRY = [{ method: "GET", path: "/api/health", kind: "legacy", safety: "read-only" }] as const;',
		].join("\n"),
		"packages/workbench-contracts/package.json": JSON.stringify({
			exports: { ".": "./dist/index.js", "./health": "./dist/health.js" },
		}),
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	const rules = new Set((await checkWorkbenchBoundaries(root, {
		endpointRegistry: [
			{ method: "GET", path: "/api/health", kind: "legacy" },
		],
	})).map((finding) => finding.rule));
	for (const rule of [
		"web-direct-api-fetch",
		"web-server-internals-import",
		"web-legacy-response-parser",
		"web-legacy-endpoint-not-allowed",
		"web-legacy-api-facade",
		"server-route-legacy-error-envelope",
		"contracts-forbidden-import",
		"contracts-package-root-export-only",
		"contracts-root-entrypoint-only",
		"registry-unexpected-legacy-endpoint",
	]) {
		assert.ok(rules.has(rule), `missing finding for ${rule}`);
	}
});

test("allows the narrow client, SSE, file download, and remaining legacy seams", async (t) => {
	const root = await fixture({
		"workbench/web/src/lib/api/client.ts": 'fetch("/api/health");',
		"workbench/web/src/lib/api/prompt.ts": 'fetch("/api/prompt");',
		"workbench/web/src/lib/api/batch-digest.ts":
			'fetch("/api/knowledge-bases/batch-digest");',
		"workbench/web/src/lib/api/legacy.ts": [
			'const response = await fetch("/api/commands");',
			'const json = (await response.json()) as { ok: boolean; items?: unknown[]; error?: string };',
		].join("\n"),
		"workbench/web/src/lib/api/artifacts.ts":
			'export const fileUrl = "/api/artifacts/id/files/name";',
		"workbench/server/src/routes/prompt.ts":
			'writer.write({ type: "tool_status_end", result: { error: null } });',
		"packages/workbench-contracts/src/index.ts": [
			'import { z } from "zod";',
			'export * from "./errors.js";',
		].join("\n"),
		"packages/workbench-contracts/src/errors.ts": 'import { z } from "zod";',
		"packages/workbench-contracts/src/endpoints.ts": [
			'export const ENDPOINT_REGISTRY = [{ method: "GET", path: "/api/commands", kind: "legacy", safety: "read-only" }] as const;',
		].join("\n"),
		"packages/workbench-contracts/package.json": JSON.stringify({
			exports: { ".": "./dist/index.js" },
		}),
	});
	t.after(() => rm(root, { recursive: true, force: true }));

	assert.deepEqual(await checkWorkbenchBoundaries(root, {
		endpointRegistry: [
			{ method: "GET", path: "/api/commands", kind: "legacy" },
		],
	}), []);
});
