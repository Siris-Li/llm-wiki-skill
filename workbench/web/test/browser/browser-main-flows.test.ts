import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chromium, type Browser, type BrowserContext, type BrowserServer, type Page } from "playwright";
import type { GraphReadData } from "@llm-wiki/workbench-contracts";

import {
	OPERATION_TIMEOUT_MS,
	REPO_ROOT,
	SERVER_ENTRY,
	START_TIMEOUT_MS,
	VITE_ENTRY,
	WEB_ROOT,
	assertPortAvailable,
	assertProductionBuildExcludesBrowserFakes,
	availablePort,
	blockExternalBrowserTraffic,
	closeBrowserResources,
	createConversation,
	createKnowledgeBase as createBaseKnowledgeBase,
	isolatedEnvironment,
	platformSandboxEnvironment,
	prepareSandboxDirectories,
	sanitizeBrowserOutput,
	startNetworkGuardedProcess,
	stopProcess,
	type RunningProcess,
	waitForFile,
	waitUntil,
} from "./support/browser-harness";

const FAILURE_DIR = join(REPO_ROOT, ".tmp/browser-main-flows");
const WEB_PORT = 5180;
const FORBIDDEN_PARENT_ENV = [
	"ANTHROPIC_API_KEY",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AZURE_OPENAI_API_KEY",
	"GOOGLE_API_KEY",
	"OPENAI_API_KEY",
	"PI_CONFIG_DIR",
	"XDG_CONFIG_HOME",
] as const;

test("seven browser main flows cross the real frontend and backend", { timeout: 210_000 }, async (t) => {
	for (const name of FORBIDDEN_PARENT_ENV) assert.equal(process.env[name], undefined, `${name} was not cleared`);
	await rm(FAILURE_DIR, { recursive: true, force: true });
	await assertPortAvailable(WEB_PORT);
	const sandbox = await mkdtemp(join(tmpdir(), "llm-wiki-browser-main-flows-"));
	const home = join(sandbox, "home");
	const appDir = join(home, ".llm-wiki-agent");
	const kbA = join(home, "llm-wiki", "atlas-notes");
	const kbB = join(home, "llm-wiki", "harbor-notes");
	const serverNetworkProbe = join(home, "server-network-probe.txt");
	const viteNetworkProbe = join(home, "vite-network-probe.txt");
	const backendPort = await availablePort();
	const webPort = WEB_PORT;
	const webOrigin = `http://127.0.0.1:${webPort}`;
	let server: RunningProcess | undefined;
	let vite: RunningProcess | undefined;
	let browserServer: BrowserServer | undefined;
	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	let page: Page | undefined;
	let cleanupComplete = false;

	const cleanup = async () => {
		if (cleanupComplete) return;
		const errors: unknown[] = [];
		await closeBrowserResources({ context, browser, browserServer }).catch((error) => errors.push(error));
		context = undefined;
		browser = undefined;
		browserServer = undefined;
		if (vite) await stopProcess(vite, [0, 143]).catch((error) => errors.push(error));
		vite = undefined;
		if (server) await stopProcess(server).catch((error) => errors.push(error));
		server = undefined;
		await assertPortAvailable(webPort).catch((error) => errors.push(error));
		await assertPortAvailable(backendPort).catch((error) => errors.push(error));
		await rm(sandbox, { recursive: true, force: true }).catch((error) => errors.push(error));
		cleanupComplete = true;
		if (errors.length > 0) throw new AggregateError(errors, "browser main flows cleanup failed");
	};
	t.after(cleanup);

	try {
		await prepareSandboxDirectories(home);
		await createKnowledgeBase(kbA, "Atlas Notes", "Atlas-only fictional signal");
		await createKnowledgeBase(kbB, "Harbor Notes", "Harbor-only fictional signal");
		const atlasConversation = await createConversation(appDir, kbA, "Atlas opening message");
		const harborConversation = await createConversation(appDir, kbB, "Harbor opening message");
		await createArtifacts(appDir, atlasConversation, kbA);
		const authDir = join(home, ".pi", "agent");
		await mkdir(authDir, { recursive: true });
		await writeFile(join(authDir, "auth.json"), `${JSON.stringify({
			anthropic: { type: "api_key", key: "fictional-browser-credential" },
		}, null, 2)}\n`);
		await chmod(join(authDir, "auth.json"), 0o600);
		await writeFile(join(authDir, "settings.json"), `${JSON.stringify({
			retry: { enabled: false },
		}, null, 2)}\n`);
		await mkdir(appDir, { recursive: true });
		await writeFile(join(appDir, "config.json"), `${JSON.stringify({
			version: 1,
			externalKnowledgeBases: [kbA, kbB],
			lastUsedKbPath: kbA,
			modelRoles: {
				main: { provider: "browser-test-provider", modelId: "browser-test-model" },
			},
		}, null, 2)}\n`);

		server = await startBackend(home, backendPort, kbB, serverNetworkProbe);
		vite = await startNetworkGuardedProcess(
			process.execPath,
			[VITE_ENTRY, "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
			WEB_ROOT,
			{
				HOME: home,
				LANG: "C.UTF-8",
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				TMPDIR: join(home, "tmp"),
				LLM_WIKI_AGENT_API_ORIGIN: `http://127.0.0.1:${backendPort}`,
				LLM_WIKI_AGENT_DISABLE_HMR: "1",
				...platformSandboxEnvironment(home),
			},
			(output) => output.includes("Local:"),
			"Vite frontend",
			viteNetworkProbe,
		);

		browserServer = await chromium.launchServer({
			headless: true,
			env: {
				HOME: home,
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				TMPDIR: join(home, "tmp"),
				LANG: "C.UTF-8",
				...platformSandboxEnvironment(home),
			},
		});
		browser = await chromium.connect(browserServer.wsEndpoint());
		context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
		const blockedExternalRequests: string[] = [];
		await blockExternalBrowserTraffic(context, blockedExternalRequests);
		page = await context.newPage();
		const apiRequests = new Set<string>();
		let browserGraphReadCount = 0;
		let graphEventsSeen = false;
		const graphEventReceipts: Array<{ type: string; kbPath?: string; seq: number }> = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (url.pathname.startsWith("/api/")) apiRequests.add(url.pathname);
			if (url.pathname === "/api/graph" && request.method() === "GET") browserGraphReadCount += 1;
			if (url.pathname === "/api/events") graphEventsSeen = true;
		});
		await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
		await page.getByText("atlas-notes", { exact: false }).first().waitFor({ timeout: START_TIMEOUT_MS });
		await waitUntil(
			() => apiRequests.has("/api/commands"),
			OPERATION_TIMEOUT_MS,
			"command list was not loaded",
		);
		const composer = page.getByPlaceholder(/写下想法/);
		await composer.fill("/");
		await page.getByRole("option", { name: /sediment_to_wiki/ }).waitFor();
		await composer.fill("");

		// Knowledge bases: selection, clearing, restart recovery, and isolation.
		await page.getByText("harbor-notes", { exact: true }).click();
		await page.getByLabel("当前知识库").getByText("harbor-notes").waitFor();
		assert.equal(await activeConversationId(page), harborConversation);
		await page.getByLabel("用户气泡").getByText("Harbor opening message", { exact: true }).waitFor();
		assert.equal(await page.getByLabel("用户气泡").getByText("Atlas opening message", { exact: true }).count(), 0);
		assert.equal(await page.getByRole("button", { name: /产物/ }).count(), 0);
		const retrievalLogDir = join(appDir, "logs", "retrieval");
		await startComposerMessage(page, "[refs] show harbor page");
		await page.getByText("wiki/entities/shared.md", { exact: true }).last().click();
		await page.getByText("Harbor-only fictional signal", { exact: false }).waitFor();
		await page.getByLabel("关闭").last().click();
		const shortQuestion = "q9x";
		const longQuestionPrefix = "fictional-long-question-marker-";
		const longQuestion = `${longQuestionPrefix}${"fictional-detail-".repeat(32)}fictional-long-question-tail`;
		const sensitiveMarker = "FICTIONAL_SENSITIVE_LOG_MARKER";
		const sensitiveQuestion = `${sensitiveMarker} fictional confidential topic`;
		await sendComposerMessage(page, shortQuestion);
		await sendComposerMessage(page, longQuestion);
		await sendComposerMessage(page, sensitiveQuestion);
		await waitUntil(
			() => readdir(retrievalLogDir).then((files) => files.some((file) => file.endsWith(".jsonl")), () => false),
			OPERATION_TIMEOUT_MS,
			"retrieval log did not appear",
		);
		const retrievalLogContents = await Promise.all(
			(await readdir(retrievalLogDir))
				.filter((file) => file.endsWith(".jsonl"))
				.map((file) => readFile(join(retrievalLogDir, file), "utf8")),
		);
		const retrievalEntries = retrievalLogContents.flatMap((content) => content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
			sessionId: string;
			kbPath: string;
			triggered: boolean;
			results: Array<{ path: string }>;
		}));
		assert.equal(retrievalEntries.some((entry) => (
			entry.sessionId === harborConversation
			&& entry.kbPath === kbB
			&& entry.triggered
			&& entry.results.some((result) => result.path === "wiki/entities/shared.md")
		)), true);
		const serializedRetrievalLogs = retrievalLogContents.join("\n");
		for (const fragment of [shortQuestion, longQuestionPrefix, sensitiveMarker]) {
			assert.equal(
				serializedRetrievalLogs.includes(fragment),
				false,
				`default retrieval logs must not contain ${fragment}`,
			);
		}
		await page.getByRole("tab", { name: "图谱" }).click();
		await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });
		await page.getByText("2 节点 · 0 关联", { exact: true }).waitFor();
		await page.getByRole("tab", { name: "对话" }).click();
		await assertBrowserJson(page, `/api/page?kb=${encodeURIComponent(kbB)}&path=${encodeURIComponent("wiki/entities/shared.md")}`, 200, /Harbor-only fictional signal/);
		await assertBrowserJson(page, `/api/page?kb=${encodeURIComponent(kbA)}&path=${encodeURIComponent("wiki/entities/shared.md")}`, 200, /Atlas-only fictional signal/);
		await assertBrowserJson(page, `/api/conversations?kb=${encodeURIComponent(kbB)}`, 200, /Harbor opening message/);
		assert.doesNotMatch((await browserJson(page, `/api/conversations?kb=${encodeURIComponent(kbB)}`)).text, /Atlas opening message/);
		await assertBrowserJson(page, `/api/graph?kb=${encodeURIComponent(kbB)}`, 200, /Harbor-only fictional signal/);
		assert.doesNotMatch((await browserJson(page, `/api/graph?kb=${encodeURIComponent(kbB)}`)).text, /Atlas-only fictional signal/);
		assert.deepEqual(JSON.parse((await browserJson(page, `/api/artifacts?conversation=${encodeURIComponent(harborConversation)}`)).text).data, []);
		assert.equal(JSON.parse((await browserJson(page, `/api/artifacts?conversation=${encodeURIComponent(atlasConversation)}`)).text).data.length, 2);
		await page.evaluate(() => fetch("/api/knowledge-base", { method: "DELETE" }).then((response) => response.json()));
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.getByText("左侧选一个知识库进入对话").waitFor();
		await page.getByText("atlas-notes", { exact: true }).click();
		await page.getByLabel("当前知识库").getByText("atlas-notes").waitFor();

		await page.goto("about:blank");
		server = await restartBackend(server, home, backendPort, kbB, serverNetworkProbe);
		graphEventsSeen = false;
		const graphEventsResponse = page.waitForResponse((response) => (
			new URL(response.url()).pathname === "/api/events" && response.status() === 200
		));
		await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
		await graphEventsResponse;
		await waitUntil(() => graphEventsSeen, OPERATION_TIMEOUT_MS, "browser did not reconnect graph events");
		await page.getByLabel("当前知识库").getByText("atlas-notes").waitFor({ timeout: START_TIMEOUT_MS });
		await page.getByLabel("用户气泡").getByText("Atlas opening message", { exact: true }).waitFor();
		assert.equal(await page.getByLabel("用户气泡").getByText("Harbor opening message", { exact: true }).count(), 0);
		await page.getByRole("button", { name: /产物 2/ }).waitFor();

		// Conversations: create, retain an empty conversation, switch, and refresh.
		await page.getByLabel("新对话").click();
		await page.getByText("(新对话)", { exact: true }).waitFor();
		let emptyConversationId: string | null = null;
		await waitUntil(async () => {
			emptyConversationId = await activeConversationId(page!);
			return emptyConversationId !== null;
		}, OPERATION_TIMEOUT_MS, "empty conversation did not become active");
		await page.reload({ waitUntil: "domcontentloaded" });
		await waitUntil(
			async () => await activeConversationId(page!) === emptyConversationId,
			OPERATION_TIMEOUT_MS,
			`empty conversation changed after refresh (original atlas conversation: ${atlasConversation})`,
		);
		await page.getByText("Atlas opening message", { exact: true }).click();
		await waitUntil(
			async () => await activeConversationId(page!) === atlasConversation,
			OPERATION_TIMEOUT_MS,
			"original conversation was not selected",
		);

		// Pages and refs: missing page is recoverable, then a real page opens.
		await startComposerMessage(page, "[refs] show both pages");
		await page.getByText("wiki/entities/shared.md", { exact: true }).waitFor({ timeout: OPERATION_TIMEOUT_MS });
		await page.getByText("wiki/entities/missing.md", { exact: true }).click();
		await page.getByText("页面不存在", { exact: false }).waitFor();
		await page.getByLabel("关闭").last().click();
		await page.getByText("wiki/entities/shared.md", { exact: true }).click();
		await page.getByText("Atlas-only fictional signal", { exact: false }).waitFor();
		await page.getByLabel("关闭").last().click();

		// Graph: real read, rebuild, queued busy state, failure recovery, and event stream.
		await page.getByRole("tab", { name: "图谱" }).click();
		await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });
		await page.getByText("1 节点 · 0 关联", { exact: true }).waitFor();
		await page.evaluate(() => {
			const receipts: Array<{ type: string; kbPath?: string; seq: number }> = [];
			const source = new EventSource("/api/events");
			source.onmessage = (message) => receipts.push(JSON.parse(message.data));
			Object.assign(window, { __graphEventReceipts: receipts });
		});
		await waitForGraphEvent(page, graphEventReceipts, (event) => event.type === "graph_stream_ready");
		const firstResponsePromise = waitForGraphRebuildResponse(page, kbA);
		await page.getByRole("button", { name: "重构" }).click();
		assert.equal((await firstResponsePromise).status, "started");
		const busyResponses = await page.evaluate((kbPath) => Promise.all([0, 1].map(() => fetch(`/api/graph/rebuild?kb=${encodeURIComponent(kbPath)}`, { method: "POST" }).then(async (response) => ({ status: response.status, body: await response.json() })))), kbA);
		assert.equal(busyResponses.every((response) => response.status === 200), true);
		assert.equal(busyResponses.some((response) => response.body.data.status === "queued"), true);
		await assertBrowserJson(page, `/api/graph?kb=${encodeURIComponent(join(home, "missing-kb"))}`, 404, /知识库/);
		await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });
		await page.goto("about:blank");
		server = await restartBackend(server, home, backendPort, kbB, serverNetworkProbe);
		graphEventsSeen = false;
		await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
		await page.getByLabel("当前知识库").getByText("atlas-notes").waitFor({ timeout: START_TIMEOUT_MS });
		await page.getByRole("tab", { name: "图谱" }).click();
		await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });
		await page.evaluate(() => {
			const receipts: Array<{ type: string; kbPath?: string; seq: number }> = [];
			const source = new EventSource("/api/events");
			source.onmessage = (message) => receipts.push(JSON.parse(message.data));
			Object.assign(window, { __graphEventReceipts: receipts });
		});
		await waitForGraphEvent(page, graphEventReceipts, (event) => event.type === "graph_stream_ready");
		const graphDataPath = join(kbA, "wiki", "graph-data.json");
		const graphData = await readFile(graphDataPath, "utf8");
		await rm(graphDataPath, { force: true });
		await mkdir(graphDataPath);
		try {
			await refreshGraphEventReceipts(page, graphEventReceipts);
			const failureBaseline = graphEventReceipts.length;
			const failureResponsePromise = waitForGraphRebuildResponse(page, kbA);
			await page.getByRole("button", { name: "重构" }).click();
			assert.equal((await failureResponsePromise).status, "started");
			await waitForGraphEvent(page, graphEventReceipts, (event, index) => (
				index >= failureBaseline && event.type === "graph_error" && event.kbPath === kbA
			));
			await page.locator("[data-graph-status='error']").waitFor({ timeout: START_TIMEOUT_MS });
		} finally {
			await rm(graphDataPath, { recursive: true, force: true });
			await writeFile(graphDataPath, graphData);
		}
		await refreshGraphEventReceipts(page, graphEventReceipts);
		const recoveryBaseline = graphEventReceipts.length;
		const recoveryResponsePromise = waitForGraphRebuildResponse(page, kbA);
		await page.getByRole("button", { name: "重构" }).click();
		assert.equal((await recoveryResponsePromise).status, "started");
		await waitForGraphEvent(page, graphEventReceipts, (event, index) => (
			index >= recoveryBaseline && event.type === "graph_updated" && event.kbPath === kbA
		));
		await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });

		// Graph reconnect: terminal events missed while offline are reconciled from GET /api/graph.
		const capabilityToken = (await readFile(join(appDir, "runtime", "capability-token"), "utf8")).trim();
			const cdp = await context.newCDPSession(page);
			await cdp.send("Network.enable");
			const setBrowserOffline = async (offline: boolean) => {
				await cdp.send("Network.emulateNetworkConditions", {
					offline,
				latency: 0,
				downloadThroughput: -1,
				uploadThroughput: -1,
			});
			await waitUntil(
				() => page!.evaluate(() => navigator.onLine).then((online) => online === !offline),
					OPERATION_TIMEOUT_MS,
					`browser did not become ${offline ? "offline" : "online"}`,
				);
				await page!.evaluate((eventType) => window.dispatchEvent(new Event(eventType)), offline ? "offline" : "online");
			};
		const readAuthoritativeGraph = () => backendGraphRead(backendPort, capabilityToken, kbA);
		const triggerAuthoritativeGraphRebuild = () => backendGraphRebuild(backendPort, capabilityToken, kbA);

		await setBrowserOffline(true);
		const offlineGraphData = await readFile(graphDataPath, "utf8");
		await rm(graphDataPath, { force: true });
		await mkdir(graphDataPath);
		try {
			assert.equal((await triggerAuthoritativeGraphRebuild()).status, "started");
			await waitUntil(
				async () => (await tryBackendGraphRead(backendPort, capabilityToken, kbA))?.state.status === "error",
				OPERATION_TIMEOUT_MS,
				"graph error did not become authoritative while the browser was offline",
			);
			const errorCalibration = page.waitForResponse(async (response) => {
				if (new URL(response.url()).pathname !== "/api/graph" || response.status() !== 200) return false;
				const body = await response.json() as { data?: { state?: { status?: string } } };
				return body.data?.state?.status === "error";
			});
			const errorGraphReadBaseline = browserGraphReadCount;
			await setBrowserOffline(false);
			await errorCalibration;
			await page.locator("[data-graph-status='error']").waitFor({ timeout: START_TIMEOUT_MS });
			await page.getByText("图谱重建失败", { exact: true }).waitFor();
			assert.equal(browserGraphReadCount, errorGraphReadBaseline + 1);
		} finally {
			await rm(graphDataPath, { recursive: true, force: true });
			await writeFile(graphDataPath, offlineGraphData);
		}

		await setBrowserOffline(true);
		await writeFile(join(kbA, "wiki", "entities", "reconnect.md"), "# Reconnect page\n\nFictional reconnect-only graph node.\n");
		const offlineUpdateBuild = await triggerAuthoritativeGraphRebuild();
		assert.equal(["started", "queued"].includes(offlineUpdateBuild.status), true);
		await waitUntil(
			async () => {
				const snapshot = await readAuthoritativeGraph();
				return snapshot.state.status === "ready"
					&& "needsBuild" in snapshot
					&& snapshot.needsBuild === false
					&& snapshot.data.nodes.some((node) => node.id.includes("reconnect"));
			},
			OPERATION_TIMEOUT_MS,
			"graph update did not become authoritative while the browser was offline",
		);
			const readyCalibration = page.waitForResponse(async (response) => {
			if (new URL(response.url()).pathname !== "/api/graph" || response.status() !== 200) return false;
			const body = await response.json() as {
				data?: { state?: { status?: string }; data?: { nodes?: Array<{ id?: string }> } };
			};
			return body.data?.state?.status === "ready"
					&& body.data.data?.nodes?.some((node) => node.id?.includes("reconnect")) === true;
			});
			const readyGraphReadBaseline = browserGraphReadCount;
			await setBrowserOffline(false);
			await readyCalibration;
			await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });
			await page.getByText("2 节点 · 0 关联", { exact: true }).waitFor();
			assert.equal(browserGraphReadCount, readyGraphReadBaseline + 1);

			await setBrowserOffline(true);
			const calibrationFailure = page.waitForResponse((response) => (
				new URL(response.url()).pathname === "/api/graph" && response.status() === 503
			));
			await page.route("**/api/graph?*", async (route) => {
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ ok: false, code: "GRAPH_READ_FAILED", message: "Fictional internal detail" }),
				});
			});
			const failedGraphReadBaseline = browserGraphReadCount;
			await setBrowserOffline(false);
			await calibrationFailure;
			await page.locator("[data-graph-status='error']").waitFor({ timeout: START_TIMEOUT_MS });
			await page.getByTestId("graph-state")
				.getByText("图谱状态校准失败，请重新连接后重试", { exact: true })
				.waitFor();
			assert.equal((await page.locator("body").textContent())?.includes("Fictional internal detail"), false);
			assert.equal(browserGraphReadCount, failedGraphReadBaseline + 1);
			await page.unroute("**/api/graph?*");

			const eventRecoveryRead = page.waitForResponse(async (response) => {
				if (new URL(response.url()).pathname !== "/api/graph" || response.status() !== 200) return false;
				const body = await response.json() as { data?: { state?: { status?: string } } };
				return body.data?.state?.status === "ready";
			});
			assert.equal((await triggerAuthoritativeGraphRebuild()).status, "started");
			await eventRecoveryRead;
			await page.locator("[data-graph-status='ready']").waitFor({ timeout: START_TIMEOUT_MS });
			await page.getByText("2 节点 · 0 关联", { exact: true }).waitFor();
			assert.equal(await page.locator(".sidebar-error").count(), 0);
			await cdp.detach();

		// Messages: controlled terminal failures, direct failures, cancellation, disconnect recovery, and normal recovery.
		await page.getByRole("tab", { name: "对话" }).click();
		const modelErrorAttemptsFile = join(appDir, "browser-model-error-attempts");
		const safeFailureMessage = "生成回复时发生错误，请重试";
		const rawModelFailureDetail = "fictional retryable server error that must not reach the page or session";
		const rawDiagnosticDetail = "fictional diagnostic detail that must not reach the page or session";
		const rawDiagnosticStack = "fictional diagnostic stack that must not reach the page or session";
		const controlledFailureResponse = page.waitForResponse((response) => {
			const request = response.request();
			return new URL(response.url()).pathname === "/api/prompt"
				&& request.method() === "POST"
				&& request.postData()?.includes("[model-error]") === true;
		});
		await startComposerMessage(page, "[model-error] controlled terminal failure");
		await page.getByText(safeFailureMessage, { exact: true }).waitFor();
		const controlledFailureSse = await (await controlledFailureResponse).text();
		assert.equal((controlledFailureSse.match(/event: assistant_error/g) ?? []).length, 1);
		assert.equal(controlledFailureSse.includes("event: assistant_done"), false);
		assert.equal(controlledFailureSse.includes(rawModelFailureDetail), false);
		assert.equal(controlledFailureSse.includes(rawDiagnosticDetail), false);
		assert.equal(controlledFailureSse.includes(rawDiagnosticStack), false);
		assert.equal((await readFile(modelErrorAttemptsFile, "utf8")).trim().split("\n").length, 1);
		assert.equal(await page.getByPlaceholder(/写下想法/).isDisabled(), false);
		assert.equal((await page.locator("body").textContent())?.includes(rawModelFailureDetail), false);
		assert.equal((await page.locator("body").textContent())?.includes(rawDiagnosticDetail), false);
		await waitUntil(async () => (await readConversationSession(appDir, kbA, atlasConversation)).includes(safeFailureMessage), OPERATION_TIMEOUT_MS, "safe model failure was not persisted");
		const failedSession = await readConversationSession(appDir, kbA, atlasConversation);
		assert.match(failedSession, /"stopReason":"error"/);
		assert.equal(failedSession.includes(rawModelFailureDetail), false);
		assert.equal(failedSession.includes(rawDiagnosticDetail), false);
		assert.equal(failedSession.includes(rawDiagnosticStack), false);
		await page.reload({ waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
		await page.getByLabel("当前知识库").getByText("atlas-notes").waitFor({ timeout: START_TIMEOUT_MS });
		await page.getByText(safeFailureMessage, { exact: true }).waitFor();
		assert.equal((await page.locator("body").textContent())?.includes(rawModelFailureDetail), false);
		await sendComposerMessage(page, "after controlled failure recovery");

		const modelFailureFlag = join(appDir, "browser-model-fail");
		await writeFile(modelFailureFlag, "fail");
		const directFailureCount = await page.getByText(safeFailureMessage, { exact: true }).count();
		await startComposerMessage(page, "direct model entry failure");
		await waitUntil(async () => (await page!.getByText(safeFailureMessage, { exact: true }).count()) > directFailureCount, OPERATION_TIMEOUT_MS, "direct model failure was not displayed");
		assert.equal(await page.getByPlaceholder(/写下想法/).isDisabled(), false);
		await rm(modelFailureFlag, { force: true });
		await sendComposerMessage(page, "after direct failure recovery");
		await startComposerMessage(page, "[slow] cancel this response");
		await page.getByText("生成中", { exact: true }).waitFor();
		await waitForFile(join(appDir, "browser-model-cancel-started"));
		const duplicate = await page.evaluate(() => fetch("/api/prompt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "duplicate while busy" }),
		}).then(async (response) => ({ status: response.status, body: await response.text() })));
		assert.equal(duplicate.status, 409);
		assert.match(duplicate.body, /BUSY/);
		await page.getByRole("button", { name: "停止" }).click();
		await waitForFile(join(appDir, "browser-model-cancel-settled"));
		await page.getByPlaceholder(/写下想法/).waitFor({ state: "visible" });
		assert.equal(await page.getByPlaceholder(/写下想法/).isDisabled(), false);
		await sendComposerMessage(page, "after cancel recovery");
		await startComposerMessage(page, "[slow] disconnect this response");
		await page.getByText("生成中", { exact: true }).waitFor();
		await waitForFile(join(appDir, "browser-model-disconnect-started"));
		await page.close();
		await waitForFile(join(appDir, "browser-model-disconnect-settled"));
		page = await context.newPage();
		await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
		await page.getByLabel("当前知识库").getByText("atlas-notes").waitFor({ timeout: START_TIMEOUT_MS });
		await page.getByText("生成已停止", { exact: true }).last().waitFor();
		await sendComposerMessage(page, "after disconnect recovery");

		// Artifacts: list, preview, download, missing resource prompt, then recover.
		await page.getByRole("button", { name: /产物 2/ }).click();
		await page.getByRole("button", { name: /Atlas HTML/ }).click();
		await page.getByTitle("Atlas HTML").waitFor();
		const downloadPromise = page.waitForEvent("download");
		await page.getByLabel("下载").click();
		const download = await downloadPromise;
		assert.equal(download.suggestedFilename(), "atlas.html");
		assert.equal(await download.failure(), null);
		const downloadPath = join(sandbox, "atlas-download.html");
		await download.saveAs(downloadPath);
		assert.match(await readFile(downloadPath, "utf8"), /Atlas artifact only/);
		await page.frameLocator('iframe[title="Atlas HTML"]').getByText("Atlas artifact only", { exact: true }).waitFor();
		await page.getByRole("button", { name: /Missing HTML/ }).click();
		await page.getByText("HTML 加载失败", { exact: true }).waitFor();
		await page.getByRole("button", { name: /Atlas HTML/ }).click();
		await page.getByTitle("Atlas HTML").waitFor();
		await page.getByLabel("关闭").last().click();

		// Settings and models: persisted setting, model list, and redacted auth status.
		await page.getByRole("button", { name: "设置" }).last().click();
		await page.getByText("auth.json：已存在", { exact: true }).waitFor();
		await page.getByText(/项目内置 \d+ 个 \/ pi 默认 \d+ 个 \/ 用户全局 \d+ 个/).waitFor();
		assert.equal((await page.locator("select").nth(1).locator("option").allTextContents()).length > 1, true);
		const skillsToggle = page.getByRole("checkbox");
		await skillsToggle.check();
		await waitUntil(async () => {
			const config = JSON.parse((await browserJson(page!, "/api/config")).text) as { data?: { showUserGlobalSkills?: boolean } };
			return config.data?.showUserGlobalSkills === true;
		}, OPERATION_TIMEOUT_MS, "settings were not saved");
		const authBody = (await browserJson(page, "/api/auth/status")).text;
		const authStatus = JSON.parse(authBody) as { data: { providers: Array<{ id: string }>; envKeys: Array<{ present: boolean }> } };
		assert.deepEqual(authStatus.data.providers.map((provider) => provider.id), ["anthropic"]);
		assert.equal(authStatus.data.envKeys.every((item) => item.present === false), true);
		assert.doesNotMatch(authBody, /\.pi\/agent\/auth\.json|fictional-browser-credential|(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}/i);

		assert.equal(apiRequests.has("/api/knowledge-base"), true);
		assert.equal(apiRequests.has("/api/events"), true);
		assert.equal(blockedExternalRequests.every((origin) => origin === "https://fonts.googleapis.com" || origin === "https://fonts.gstatic.com"), true);
		await cleanup();
		await assertProductionBuildExcludesBrowserFakes();
		await rm(FAILURE_DIR, { recursive: true, force: true });
	} catch (error) {
		await mkdir(FAILURE_DIR, { recursive: true });
		await page?.screenshot({ path: join(FAILURE_DIR, "failure.png"), fullPage: true }).catch(() => undefined);
		const raw = `${server?.output() ?? ""}\n${vite?.output() ?? ""}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
		await writeFile(join(FAILURE_DIR, "failure.log"), sanitizeBrowserOutput(raw, sandbox), "utf8");
		throw error;
	}
});

async function startBackend(home: string, port: number, selectedDirectory: string, networkProbeFile: string) {
	return startNetworkGuardedProcess(
		process.execPath,
		["--import", "tsx", SERVER_ENTRY],
		REPO_ROOT,
		isolatedEnvironment(home, port, selectedDirectory),
		(output) => output.includes("listening on http://"),
		"browser backend",
		networkProbeFile,
	);
}

async function restartBackend(running: RunningProcess, home: string, port: number, selectedDirectory: string, networkProbeFile: string) {
	await stopProcess(running);
	return startBackend(home, port, selectedDirectory, networkProbeFile);
}

async function createKnowledgeBase(path: string, title: string, sharedText: string): Promise<void> {
	await createBaseKnowledgeBase(path, title, sharedText);
	const harborNode = title === "Harbor Notes"
		? [{ id: "harbor-extra", label: "Harbor extra", type: "entity", community: null, content: "Harbor-only second node", source_path: join(path, "wiki/entities/shared.md") }]
		: [];
	await writeFile(join(path, "wiki/graph-data.json"), `${JSON.stringify({
		meta: { build_date: "2026-07-13T00:00:00Z", wiki_title: title, total_nodes: 1 + harborNode.length, total_edges: 0, initial_view: ["shared", ...harborNode.map((node) => node.id)], degraded: false },
		nodes: [{ id: "shared", label: `${title} shared`, type: "entity", community: null, content: sharedText, source_path: join(path, "wiki/entities/shared.md") }, ...harborNode],
		edges: [],
	}, null, 2)}\n`);
}

async function createArtifacts(appDir: string, conversationId: string, kbPath: string): Promise<void> {
	const artifacts = [
		{ id: randomUUID(), title: "Atlas HTML", primaryFile: "atlas.html", content: "<!doctype html><title>Atlas HTML preview</title><main>Atlas artifact only</main>" },
		{ id: randomUUID(), title: "Missing HTML", primaryFile: "missing.html", content: null },
	];
	for (const artifact of artifacts) {
		const dir = join(appDir, "artifacts", artifact.id);
		await mkdir(dir, { recursive: true });
		if (artifact.content) await writeFile(join(dir, artifact.primaryFile), artifact.content);
		await writeFile(join(dir, "manifest.json"), `${JSON.stringify({
			id: artifact.id,
			kind: "html",
			renderer: "iframe",
			metadata: { title: artifact.title, createdAt: new Date().toISOString(), sourceConversationId: conversationId, sourceKbPath: kbPath, sourceSkill: "browser-fixture", sizeBytes: artifact.content?.length ?? 1 },
			files: [{ name: artifact.primaryFile, sizeBytes: artifact.content?.length ?? 1, mimeType: "text/html; charset=utf-8" }],
			primaryFile: artifact.primaryFile,
		}, null, 2)}\n`);
	}
}

async function waitForGraphRebuildResponse(page: Page, kbPath: string): Promise<{ status: "started" | "queued" }> {
	const response = await page.waitForResponse((candidate) => {
		const request = candidate.request();
		const url = new URL(candidate.url());
		return url.pathname === "/api/graph/rebuild"
			&& url.searchParams.get("kb") === kbPath
			&& request.method() === "POST";
	});
	assert.equal(response.status(), 200);
	const body = await response.json() as { data: { status: "started" | "queued" } };
	return body.data;
}

async function refreshGraphEventReceipts(
	page: Page,
	receipts: Array<{ type: string; kbPath?: string; seq: number }>,
): Promise<void> {
	receipts.splice(0, receipts.length, ...await page.evaluate(() => (
		(window as typeof window & { __graphEventReceipts?: Array<{ type: string; kbPath?: string; seq: number }> }).__graphEventReceipts ?? []
	)));
}

async function waitForGraphEvent(
	page: Page,
	receipts: Array<{ type: string; kbPath?: string; seq: number }>,
	predicate: (event: { type: string; kbPath?: string; seq: number }, index: number) => boolean,
): Promise<void> {
	await waitUntil(async () => {
		await refreshGraphEventReceipts(page, receipts);
		return receipts.some(predicate);
	}, OPERATION_TIMEOUT_MS, "expected graph event did not arrive");
}

async function backendGraphRead(
	port: number,
	token: string,
	kbPath: string,
): Promise<GraphReadData> {
	const snapshot = await tryBackendGraphRead(port, token, kbPath);
	assert.notEqual(snapshot, null);
	return snapshot!;
}

async function tryBackendGraphRead(
	port: number,
	token: string,
	kbPath: string,
): Promise<GraphReadData | null> {
	const response = await fetch(`http://127.0.0.1:${port}/api/graph?kb=${encodeURIComponent(kbPath)}`, {
		headers: { "X-LLM-Wiki-Workbench-Token": token },
	});
	if (response.status !== 200) return null;
	const body = await response.json() as { data: GraphReadData };
	return body.data;
}

async function backendGraphRebuild(
	port: number,
	token: string,
	kbPath: string,
): Promise<{ status: "started" | "queued" }> {
	const response = await fetch(`http://127.0.0.1:${port}/api/graph/rebuild?kb=${encodeURIComponent(kbPath)}`, {
		method: "POST",
		headers: { "X-LLM-Wiki-Workbench-Token": token },
	});
	assert.equal(response.status, 200);
	const body = await response.json() as { data: { status: "started" | "queued" } };
	return body.data;
}

async function sendComposerMessage(page: Page, message: string): Promise<void> {
	const responsePromise = page.waitForResponse((response) => {
		const request = response.request();
		return new URL(response.url()).pathname === "/api/prompt" && request.method() === "POST";
	});
	await startComposerMessage(page, message);
	await page.getByLabel("助手气泡").getByText(`可控的测试回复：${message}`, { exact: true }).last().waitFor({ timeout: OPERATION_TIMEOUT_MS });
	const response = await responsePromise;
	assert.equal(await response.finished(), null);
	await page.getByPlaceholder(/写下想法/).waitFor({ state: "visible" });
}

async function startComposerMessage(page: Page, message: string): Promise<void> {
	const composer = page.getByPlaceholder(/写下想法/);
	await composer.fill(message);
	await page.getByRole("button", { name: "发送" }).click();
}

async function activeConversationId(page: Page): Promise<string | null> {
	const result = await page.evaluate(() => fetch("/api/knowledge-base").then((response) => response.json())) as { data: { active: { conversation: { id: string } } | null } };
	return result.data.active?.conversation.id ?? null;
}

async function readConversationSession(appDir: string, kbPath: string, conversationId: string): Promise<string> {
	const hash = createHash("sha256").update(kbPath).digest("hex").slice(0, 16);
	const sessionDir = join(appDir, "sessions", hash);
	const files = await readdir(sessionDir);
	const file = files.find((name) => name.endsWith(`_${conversationId}.jsonl`));
	assert.ok(file, `session file for ${conversationId} was not found`);
	return readFile(join(sessionDir, file), "utf8");
}

async function assertBrowserJson(page: Page, path: string, expectedStatus: number, expectedBody: RegExp): Promise<void> {
	const result = await browserJson(page, path);
	assert.equal(result.status, expectedStatus);
	assert.match(result.text, expectedBody);
}

async function browserJson(page: Page, path: string): Promise<{ status: number; text: string }> {
	return page.evaluate((url) => fetch(url, { signal: AbortSignal.timeout(8_000) }).then(async (response) => ({ status: response.status, text: await response.text() })), path);
}
