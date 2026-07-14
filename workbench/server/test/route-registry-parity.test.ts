import assert from "node:assert/strict";
import { test } from "node:test";

import { Hono } from "hono";

import {
	ENDPOINT_REGISTRY,
	type EndpointEntry,
} from "@llm-wiki/workbench-contracts";

import { createApp } from "../src/app.js";
import { createRuntimeApplication } from "../src/runtime-app.js";
import {
	RUNTIME_ENDPOINT_DECLARATIONS,
	assertRouteRegistryParity,
	collectMountedEndpoints,
	type MountedEndpoint,
	type RuntimeEndpointDeclaration,
} from "./support/route-registry-parity.js";

function collectCurrentMountedEndpoints(): readonly MountedEndpoint[] {
	return collectMountedEndpoints({
		assembledRoutes: createApp({ mode: "test" }).routes,
		runtimeRoutes: createRuntimeApplication("route-registry-test-token").routes,
	});
}

test("真实后台入口、后台声明与官方清单逐项一致", () => {
	const mounted = collectCurrentMountedEndpoints();
	assert.doesNotThrow(() =>
		assertRouteRegistryParity({
			mounted,
			declared: RUNTIME_ENDPOINT_DECLARATIONS,
			registry: ENDPOINT_REGISTRY,
		}),
	);
});

test("只增加真实入口会失败", () => {
	const mounted = [
		...collectCurrentMountedEndpoints(),
		{ method: "GET", path: "/api/unregistered", source: "startup" },
	] as const;

	assert.throws(
		() => assertRouteRegistryParity({ mounted, declared: RUNTIME_ENDPOINT_DECLARATIONS, registry: ENDPOINT_REGISTRY }),
		/mounted only: GET \/api\/unregistered/,
	);
});

test("真实 Hono 路由中的 ALL 和 /api 根入口不会被静默忽略", () => {
	const assembled = new Hono();
	const runtime = new Hono();
	runtime.use("/api/*", async (_c, next) => next());
	runtime.all("/api/all", (c) => c.text("ok"));
	runtime.get("/api", (c) => c.text("ok"));

	const mounted = collectMountedEndpoints({
		assembledRoutes: assembled.routes,
		runtimeRoutes: runtime.routes,
	});

	assert.deepEqual(mounted, [
		{ method: "ALL", path: "/api/all", source: "startup" },
		{ method: "GET", path: "/api", source: "startup" },
	]);
	assert.throws(
		() => assertRouteRegistryParity({ mounted, declared: [], registry: [] }),
		/mounted only: ALL \/api\/all[\s\S]*mounted only: GET \/api/,
	);
});

test("只增加官方清单条目会失败", () => {
	const mounted = collectCurrentMountedEndpoints();
	const registry: readonly EndpointEntry[] = [
		...ENDPOINT_REGISTRY,
		{
			method: "GET",
			path: "/api/registered-only",
			kind: "migrated-json",
			safety: "read-only",
		},
	];

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared: RUNTIME_ENDPOINT_DECLARATIONS,
			registry,
		}),
		/registry only: GET \/api\/registered-only/,
	);
});

test("请求方式不一致会失败", () => {
	const mounted = collectCurrentMountedEndpoints();
	const declared = replaceDeclaration("GET", "/api/health", { method: "POST" });

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared,
			registry: ENDPOINT_REGISTRY,
		}),
		/method or mount mismatch/,
	);
});

test("响应分类不一致会失败", () => {
	const mounted = collectCurrentMountedEndpoints();
	const declared = replaceDeclaration("GET", "/api/health", { kind: "legacy" });

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared,
			registry: ENDPOINT_REGISTRY,
		}),
		/kind mismatch: GET \/api\/health/,
	);
});

test("安全分类不一致会失败", () => {
	const mounted = collectCurrentMountedEndpoints();
	const declared = replaceDeclaration("GET", "/api/health", { safety: "read-only" });

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared,
			registry: ENDPOINT_REGISTRY,
		}),
		/safety mismatch: GET \/api\/health/,
	);
});

test("后台声明与官方清单同时误把其他入口改为公开也会失败", () => {
	const mounted = collectCurrentMountedEndpoints();
	const declared = replaceDeclaration("GET", "/api/config", { safety: "public" });
	const registry = ENDPOINT_REGISTRY.map((entry) =>
		entry.method === "GET" && entry.path === "/api/config"
			? { ...entry, safety: "public" as const }
			: entry,
	);

	assert.throws(
		() => assertRouteRegistryParity({ mounted, declared, registry }),
		/unapproved public endpoint: GET \/api\/config/,
	);
});

test("旧入口缺少稳定发现编号或处理任务会失败", () => {
	const mounted = collectCurrentMountedEndpoints();
	const declared = replaceDeclaration("POST", "/api/echo", {
		temporaryLegacyException: undefined,
	});

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared,
			registry: ENDPOINT_REGISTRY,
		}),
		/legacy exception metadata missing: POST \/api\/echo/,
	);
});

test("旧入口必须绑定自己的稳定发现编号和处理任务", () => {
	const mounted = collectCurrentMountedEndpoints();
	for (const [temporaryLegacyException, expected] of [
		[{ finding: "FIND-999" as const, issue: 207 }, /legacy exception mismatch: POST \/api\/echo/],
		[{ finding: "FIND-001" as const, issue: 206 }, /legacy exception mismatch: POST \/api\/echo/],
	] as const) {
		const declared = replaceDeclaration("POST", "/api/echo", {
			temporaryLegacyException,
		});
		assert.throws(
			() => assertRouteRegistryParity({ mounted, declared, registry: ENDPOINT_REGISTRY }),
			expected,
		);
	}
});

test("旧入口例外数量不能超过当前五个", () => {
	const extra: RuntimeEndpointDeclaration = {
		method: "GET",
		path: "/api/legacy-eight",
		kind: "legacy",
		safety: "read-only",
		source: "startup",
		temporaryLegacyException: { finding: "FIND-001", issue: 207 },
	};
	const mounted: readonly MountedEndpoint[] = [
		...collectCurrentMountedEndpoints(),
		{ method: extra.method, path: extra.path, source: extra.source },
	];
	const registry: readonly EndpointEntry[] = [...ENDPOINT_REGISTRY, extra];

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared: [...RUNTIME_ENDPOINT_DECLARATIONS, extra],
			registry,
		}),
		/legacy exception count increased: 6 > 5/,
	);
});

test("统一组装之外的新辅助入口没有批准和专门检查记录时会失败", () => {
	const extra: RuntimeEndpointDeclaration = {
		method: "GET",
		path: "/api/auxiliary",
		kind: "migrated-json",
		safety: "read-only",
		source: "startup",
	};
	const mounted: readonly MountedEndpoint[] = [
		...collectCurrentMountedEndpoints(),
		{ method: extra.method, path: extra.path, source: extra.source },
	];
	const registry: readonly EndpointEntry[] = [...ENDPOINT_REGISTRY, extra];

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared: [...RUNTIME_ENDPOINT_DECLARATIONS, extra],
			registry,
		}),
		/auxiliary approval metadata missing: GET \/api\/auxiliary/,
	);
});

test("伪造的辅助入口批准和检查记录不能通过", () => {
	const extra: RuntimeEndpointDeclaration = {
		method: "GET",
		path: "/api/auxiliary",
		kind: "migrated-json",
		safety: "read-only",
		source: "startup",
		approvedAuxiliary: {
			id: "AUX-001",
			approval: "https://github.com/sdyckjq-lab/llm-wiki-skill/issues/198",
			boundaryCheck: "not-a-real-check",
		},
	};
	const mounted: readonly MountedEndpoint[] = [
		...collectCurrentMountedEndpoints(),
		{ method: extra.method, path: extra.path, source: extra.source },
	];
	const registry: readonly EndpointEntry[] = [...ENDPOINT_REGISTRY, extra];

	assert.throws(
		() => assertRouteRegistryParity({
			mounted,
			declared: [...RUNTIME_ENDPOINT_DECLARATIONS, extra],
			registry,
		}),
		/unapproved auxiliary endpoint: GET \/api\/auxiliary/,
	);
});

function replaceDeclaration(
	method: string,
	path: string,
	patch: Partial<RuntimeEndpointDeclaration>,
): readonly RuntimeEndpointDeclaration[] {
	return RUNTIME_ENDPOINT_DECLARATIONS.map((entry) =>
		entry.method === method && entry.path === path
			? { ...entry, ...patch }
			: entry,
	);
}
