import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CAPABILITY_TOKEN_HEADER } from "@llm-wiki/workbench-contracts";
import { createServer as createViteServer, type UserConfig } from "vite";

import { createDevApiRequestGuard } from "../dev-api-security";

const TRUSTED_ORIGINS = new Set(["http://localhost:5180", "http://127.0.0.1:5180"]);

async function startGuardServer() {
	const guard = createDevApiRequestGuard(TRUSTED_ORIGINS);
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		guard(req, res, () => {
			res.statusCode = 204;
			res.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => error ? reject(error) : resolve()),
			);
		},
	};
}

test("dev API guard 允许工作台读取和操作，拒绝不可信直接请求", async (t) => {
	const server = await startGuardServer();
	t.after(server.close);

	for (const path of ["/api/config", "/api/config?write=1"]) {
		const trusted = await fetch(`${server.baseUrl}${path}`, {
			method: path.includes("write") ? "POST" : "GET",
			headers: { origin: "http://localhost:5180" },
		});
		assert.equal(trusted.status, 204, path);
	}

	for (const request of [
		new Request(`${server.baseUrl}/api/config`),
		new Request(`${server.baseUrl}/api/config`, { method: "POST" }),
		new Request(`${server.baseUrl}/api/config`, { headers: { origin: "https://evil.example" } }),
	]) {
		const denied = await fetch(request);
		assert.equal(denied.status, 403);
		assert.deepEqual(await denied.json(), {
			ok: false,
			code: "FORBIDDEN_ORIGIN",
			message: "请求来源不是工作台可信来源",
		});
	}
});

test("dev API guard 保持 public health 可用", async (t) => {
	const server = await startGuardServer();
	t.after(server.close);
	const response = await fetch(`${server.baseUrl}/api/health`);
	assert.equal(response.status, 204);
});

test("dev API guard 接受同源浏览器信号并优先拒绝明确跨站信号", async (t) => {
	const server = await startGuardServer();
	t.after(server.close);

	const sameOrigin = await fetch(`${server.baseUrl}/api/config`, {
		headers: { "sec-fetch-site": "same-origin" },
	});
	assert.equal(sameOrigin.status, 204);

	const crossSite = await fetch(`${server.baseUrl}/api/config`, {
		headers: {
			origin: "http://localhost:5180",
			"sec-fetch-site": "cross-site",
		},
	});
	assert.equal(crossSite.status, 403);
});

test("Vite 开发代理为所有可信本地内容请求附带 capability token", async (t) => {
	const token = "proxy-integration-secret";
	const home = await mkdtemp(join(tmpdir(), "llm-wiki-dev-proxy-"));
	await mkdir(join(home, ".llm-wiki-agent", "runtime"), { recursive: true });
	await writeFile(
		join(home, ".llm-wiki-agent", "runtime", "capability-token"),
		token,
		{ mode: 0o600 },
	);
	const received: Array<{ method?: string; path?: string; token?: string }> = [];
	const backend = createServer((request, response) => {
		received.push({
			method: request.method,
			path: request.url,
			token: request.headers[CAPABILITY_TOKEN_HEADER.toLowerCase()] as string | undefined,
		});
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ ok: true }));
	});
	await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
	const backendAddress = backend.address();
	assert.ok(backendAddress && typeof backendAddress !== "string");

	const previousHome = process.env.HOME;
	const previousOrigin = process.env.LLM_WIKI_AGENT_API_ORIGIN;
	process.env.HOME = home;
	process.env.LLM_WIKI_AGENT_API_ORIGIN = `http://127.0.0.1:${backendAddress.port}`;
	const resources: {
		vite?: Awaited<ReturnType<typeof createViteServer>>;
	} = {};
	t.after(async () => {
		if (resources.vite) await resources.vite.close();
		backend.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			backend.close((error) => error ? reject(error) : resolve()),
		);
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousOrigin === undefined) delete process.env.LLM_WIKI_AGENT_API_ORIGIN;
		else process.env.LLM_WIKI_AGENT_API_ORIGIN = previousOrigin;
		await rm(home, { recursive: true, force: true });
	});

	const imported = await import(`../vite.config.ts?security-test=${Date.now()}`);
	const config = imported.default as UserConfig;
	resources.vite = await createViteServer({
		...config,
		configFile: false,
		server: { ...config.server, port: 0, strictPort: false },
	});
	await resources.vite.listen();
	const baseUrl = resources.vite.resolvedUrls?.local[0];
	assert.ok(baseUrl);

	const publicHealth = await fetch(new URL("/api/health", baseUrl));
	assert.equal(publicHealth.status, 200);
	assert.equal(received.at(-1)?.token, undefined);

	const deniedRead = await fetch(new URL("/api/config", baseUrl));
	assert.equal(deniedRead.status, 403);
	assert.equal(received.length, 1);

	const trustedRead = await fetch(new URL("/api/config", baseUrl), {
		headers: { origin: "http://localhost:5180" },
	});
	assert.equal(trustedRead.status, 200);
	assert.equal(received.at(-1)?.token, token);

	const trustedWrite = await fetch(new URL("/api/config", baseUrl), {
		method: "POST",
		headers: { origin: "http://localhost:5180" },
	});
	assert.equal(trustedWrite.status, 200);
	assert.equal(received.at(-1)?.token, token);

	const beforeDeniedWrite = received.length;
	const deniedWrite = await fetch(new URL("/api/config", baseUrl), { method: "POST" });
	assert.equal(deniedWrite.status, 403);
	assert.equal(received.length, beforeDeniedWrite);
});
