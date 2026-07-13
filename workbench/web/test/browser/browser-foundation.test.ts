import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { chromium, type Browser, type BrowserContext } from "playwright";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const WEB_ROOT = join(REPO_ROOT, "workbench/web");
const SERVER_ENTRY = join(REPO_ROOT, "workbench/server/test/browser-entry.ts");
const NETWORK_GUARD = join(REPO_ROOT, "workbench/server/test/support/network-guard.mjs");
const VITE_ENTRY = join(REPO_ROOT, "node_modules/vite/bin/vite.js");
const WEB_PORT = 5180;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const START_TIMEOUT_MS = 30_000;
const OPERATION_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 5_000;
const FAKE_MODEL_MARKER = "browser-foundation-fake-model";

interface RunningProcess {
	child: ChildProcess;
	output: () => string;
}

interface BrowserEvidence {
	health: { status: number; body: unknown };
	knowledgeBases: { status: number; body: unknown };
	conversationsA: { status: number; body: unknown };
	conversationsB: { status: number; body: unknown };
	sharedPageA: { status: number; body: unknown };
	sharedPageB: { status: number; body: unknown };
	chosenDirectory: { status: number; body: unknown };
	promptStatus: number;
	promptContentType: string | null;
	promptBody: string;
}

test("browser foundation uses real frontend, HTTP, SSE, and backend processing", { timeout: 90_000 }, async (t) => {
	await assertPortAvailable(WEB_PORT);
	const sandbox = await mkdtemp(join(tmpdir(), "llm-wiki-browser-foundation-"));
	const home = join(sandbox, "home");
	const appDir = join(home, ".llm-wiki-agent");
	const kbA = join(home, "llm-wiki", "atlas-notes");
	const kbB = join(home, "llm-wiki", "harbor-notes");
	const serverNetworkProbe = join(home, "server-network-probe.txt");
	const viteNetworkProbe = join(home, "vite-network-probe.txt");
	const backendPort = await availablePort();
	let server: RunningProcess | undefined;
	let vite: RunningProcess | undefined;
	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	let cleanupComplete = false;

	const cleanup = async () => {
		if (cleanupComplete) return;
		const errors: unknown[] = [];
		if (context) {
			try {
				await withTimeout(context.close(), STOP_TIMEOUT_MS, "browser context did not close");
				context = undefined;
			} catch (error) {
				errors.push(error);
			}
		}
		if (browser) {
			try {
				await withTimeout(browser.close(), STOP_TIMEOUT_MS, "browser did not close");
				browser = undefined;
			} catch (error) {
				errors.push(error);
			}
		}
		if (vite) {
			try {
				await stopProcess(vite, [0, 143]);
				vite = undefined;
			} catch (error) {
				errors.push(error);
			}
		}
		if (server) {
			try {
				await stopProcess(server);
				server = undefined;
			} catch (error) {
				errors.push(error);
			}
		}
		await assertPortAvailable(WEB_PORT).catch((error) => errors.push(error));
		await assertPortAvailable(backendPort).catch((error) => errors.push(error));
		await rm(sandbox, { recursive: true, force: true }).catch((error) => errors.push(error));
		if (errors.length > 0) throw new AggregateError(errors, "browser foundation cleanup failed");
		cleanupComplete = true;
	};
	t.after(cleanup);

	await createKnowledgeBase(kbA, "Atlas Notes", "Shared fictional signal");
	await createKnowledgeBase(kbB, "Harbor Notes", "Shared fictional signal");
	await createConversation(appDir, kbA, "Atlas opening message");
	await createConversation(appDir, kbB, "Harbor opening message");
	await mkdir(appDir, { recursive: true });
	await writeFile(join(appDir, "config.json"), `${JSON.stringify({
		version: 1,
		externalKnowledgeBases: [kbA, kbB],
		lastUsedKbPath: kbA,
	}, null, 2)}\n`);

	server = await startProcess(
		process.execPath,
		["--import", "tsx", SERVER_ENTRY],
		REPO_ROOT,
		isolatedEnvironment(home, backendPort, kbB, serverNetworkProbe),
		(output) => output.includes("listening on http://"),
		"browser backend",
	);
	vite = await startProcess(
		process.execPath,
		[VITE_ENTRY, "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
		WEB_ROOT,
		{
			HOME: home,
			LANG: "C.UTF-8",
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			TMPDIR: join(home, "tmp"),
			LLM_WIKI_AGENT_API_ORIGIN: `http://127.0.0.1:${backendPort}`,
			LLM_WIKI_AGENT_DISABLE_HMR: "1",
			...networkGuardEnvironment(viteNetworkProbe),
		},
		(output) => output.includes("Local:"),
		"Vite frontend",
	);
	await waitForFile(serverNetworkProbe, OPERATION_TIMEOUT_MS);
	await waitForFile(viteNetworkProbe, OPERATION_TIMEOUT_MS);
	assert.equal(await readFile(serverNetworkProbe, "utf8"), "BLOCKED");
	assert.equal(await readFile(viteNetworkProbe, "utf8"), "BLOCKED");

	browser = await chromium.launch({ headless: true });
	context = await browser.newContext();
	const blockedExternalRequests: string[] = [];
	await context.route(
		/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$)|localhost(?::\d+)?(?:\/|$))/,
		async (route) => {
			const url = new URL(route.request().url());
			blockedExternalRequests.push(url.origin);
			await route.abort("blockedbyclient");
		},
	);

	const page = await context.newPage();
	const apiRequests = new Set<string>();
	let eventStreamSeen = false;
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith("/api/")) apiRequests.add(url.pathname);
		if (url.pathname === "/api/events") eventStreamSeen = true;
	});
	await page.goto(WEB_ORIGIN, { waitUntil: "domcontentloaded", timeout: START_TIMEOUT_MS });
	await page.getByText("atlas-notes", { exact: false }).first().waitFor({ timeout: START_TIMEOUT_MS });
	await waitUntil(() => eventStreamSeen, OPERATION_TIMEOUT_MS, "browser did not open the real event stream");

	const evidence = await page.evaluate<BrowserEvidence>(`(async () => {
		const { kbAPath, kbBPath, operationTimeoutMs } = ${JSON.stringify({
			kbAPath: kbA,
			kbBPath: kbB,
			operationTimeoutMs: OPERATION_TIMEOUT_MS,
		})};
		const json = async (path, init) => {
			const response = await fetch(path, {
				...init,
				signal: AbortSignal.timeout(operationTimeoutMs),
			});
			return { status: response.status, body: await response.json() };
		};
		const health = await json("/api/health");
		const knowledgeBases = await json("/api/knowledge-bases");
		const conversationsA = await json("/api/conversations?kb=" + encodeURIComponent(kbAPath));
		const conversationsB = await json("/api/conversations?kb=" + encodeURIComponent(kbBPath));
		const sharedPageA = await json("/api/page?kb=" + encodeURIComponent(kbAPath) + "&path=" + encodeURIComponent("wiki/entities/shared.md"));
		const sharedPageB = await json("/api/page?kb=" + encodeURIComponent(kbBPath) + "&path=" + encodeURIComponent("wiki/entities/shared.md"));
		const chosenDirectory = await json("/api/system/choose-directory", { method: "POST" });
		const promptResponse = await fetch("/api/prompt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "Foundation probe" }),
			signal: AbortSignal.timeout(operationTimeoutMs),
		});
		return {
			health,
			knowledgeBases,
			conversationsA,
			conversationsB,
			sharedPageA,
			sharedPageB,
			chosenDirectory,
			promptStatus: promptResponse.status,
			promptContentType: promptResponse.headers.get("content-type"),
			promptBody: await promptResponse.text(),
		};
	})()`);

	assert.equal(evidence.health.status, 200);
	assert.equal(evidence.knowledgeBases.status, 200);
	assert.equal((evidence.knowledgeBases.body as { data: unknown[] }).data.length, 2);
	assert.equal((evidence.conversationsA.body as { data: unknown[] }).data.length, 1);
	assert.equal((evidence.conversationsB.body as { data: unknown[] }).data.length, 1);
	assert.match(JSON.stringify(evidence.sharedPageA.body), /Shared fictional signal/);
	assert.match(JSON.stringify(evidence.sharedPageB.body), /Shared fictional signal/);
	assert.deepEqual(evidence.chosenDirectory, {
		status: 200,
		body: { ok: true, path: kbB },
	});
	assert.equal(evidence.promptStatus, 200);
	assert.match(evidence.promptContentType ?? "", /text\/event-stream/);
	assert.match(evidence.promptBody, /可控的测试回复/);
	assert.match(evidence.promptBody, /assistant_done/);
	assert.match(server.output(), new RegExp(FAKE_MODEL_MARKER));
	assert.equal(apiRequests.has("/api/knowledge-base"), true);
	assert.equal(apiRequests.has("/api/events"), true);
	assert.equal(
		blockedExternalRequests.every((origin) =>
			origin === "https://fonts.googleapis.com" || origin === "https://fonts.gstatic.com"),
		true,
	);

	await cleanup();
	await assertProductionBuildExcludesBrowserFakes();
});

async function createKnowledgeBase(path: string, title: string, sharedText: string): Promise<void> {
	await mkdir(join(path, "wiki/entities"), { recursive: true });
	await writeFile(join(path, ".wiki-schema.md"), `# ${title} schema\n`);
	await writeFile(join(path, "wiki/entities/shared.md"), `# ${title}\n\n${sharedText}\n`);
}

async function createConversation(appDir: string, kbPath: string, message: string): Promise<void> {
	const hash = createHash("sha256").update(kbPath).digest("hex").slice(0, 16);
	const sessionDir = join(appDir, "sessions", hash);
	await mkdir(sessionDir, { recursive: true });
	const manager = SessionManager.create(REPO_ROOT, sessionDir);
	manager.appendMessage({
		role: "user",
		content: [{ type: "text", text: message }],
		timestamp: Date.now(),
	} as never);
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Fictional fixture reply" }],
		timestamp: Date.now(),
	} as never);
}

function isolatedEnvironment(
	home: string,
	port: number,
	selectedDirectory: string,
	networkProbeFile: string,
): NodeJS.ProcessEnv {
	return {
		HOME: home,
		HOST: "127.0.0.1",
		PORT: String(port),
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		TMPDIR: join(home, "tmp"),
		LANG: "C.UTF-8",
		LLM_WIKI_BROWSER_SELECTED_DIRECTORY: selectedDirectory,
		...networkGuardEnvironment(networkProbeFile),
	};
}

function networkGuardEnvironment(probeFile: string): NodeJS.ProcessEnv {
	return {
		NODE_OPTIONS: `--import=${NETWORK_GUARD}`,
		LLM_WIKI_BROWSER_NETWORK_PROBE_FILE: probeFile,
		LLM_WIKI_BROWSER_NETWORK_PROBE_TARGET: "http://192.0.2.1:9",
	};
}

async function startProcess(
	command: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	ready: (output: string) => boolean,
	name: string,
): Promise<RunningProcess> {
	await mkdir(env.TMPDIR ?? join(tmpdir(), "llm-wiki-browser-tmp"), { recursive: true });
	const child = spawn(command, args, {
		cwd,
		detached: process.platform !== "win32",
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => { output += chunk; });
	child.stderr?.on("data", (chunk: string) => { output += chunk; });
	const running = { child, output: () => output };
	try {
		await waitUntil(() => ready(output), START_TIMEOUT_MS, `${name} did not start`, child, running.output);
		return running;
	} catch (error) {
		signalProcessTree(child, "SIGKILL");
		try {
			await waitForExit(child, 1_000, running.output);
		} catch (exitError) {
			throw new AggregateError(
				[error, exitError],
				`${name} failed to start and could not be stopped`,
				{ cause: exitError },
			);
		}
		throw new Error(`${String(error)}\n${output}`, { cause: error });
	}
}

async function stopProcess(
	running: RunningProcess,
	expectedExitCodes: readonly number[] = [0],
): Promise<void> {
	if (running.child.exitCode !== null || running.child.signalCode !== null) return;
	signalProcessTree(running.child, "SIGTERM");
	let result: Awaited<ReturnType<typeof waitForExit>>;
	try {
		result = await waitForExit(running.child, STOP_TIMEOUT_MS, running.output);
	} catch (error) {
		signalProcessTree(running.child, "SIGKILL");
		await waitForExit(running.child, 1_000, running.output).catch(() => undefined);
		throw error;
	}
	assert.equal(result.signal, null, running.output());
	assert.equal(expectedExitCodes.includes(result.code ?? -1), true, running.output());
}

async function waitUntil(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs: number,
	message: string,
	child?: ChildProcess,
	output?: () => string,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await predicate())) {
		if (child && (child.exitCode !== null || child.signalCode !== null)) {
			throw new Error(`${message}: process exited\n${output?.() ?? ""}`);
		}
		if (Date.now() >= deadline) throw new Error(`${message}\n${output?.() ?? ""}`);
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
	await waitUntil(
		() => stat(path).then(
			() => true,
			() => false,
		),
		timeoutMs,
		`file did not appear: ${path}`,
	);
}

async function waitForExit(
	child: ChildProcess,
	timeoutMs: number,
	output: () => string,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return { code: child.exitCode, signal: child.signalCode };
	}
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`process did not stop within ${timeoutMs}ms\n${output()}`));
		}, timeoutMs);
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			resolvePromise({ code, signal });
		});
	});
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
	if (!child.pid) return;
	try {
		if (process.platform === "win32") child.kill(signal);
		else process.kill(-child.pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolvePromise);
	});
	const address = server.address();
	assert(address && typeof address === "object");
	const port = address.port;
	await new Promise<void>((resolvePromise, reject) => {
		server.close((error) => error ? reject(error) : resolvePromise());
	});
	return port;
}

async function assertPortAvailable(port: number): Promise<void> {
	const server = createServer();
	await new Promise<void>((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolvePromise);
	});
	await new Promise<void>((resolvePromise, reject) => {
		server.close((error) => error ? reject(error) : resolvePromise());
	});
}

async function assertProductionBuildExcludesBrowserFakes(): Promise<void> {
	const dist = join(REPO_ROOT, "workbench/server/dist");
	await stat(join(dist, "index.js"));
	const files = await collectFiles(dist);
	assert.equal(files.some((file) => file.endsWith(".test.js")), false);
	assert.equal(files.some((file) => file.includes("browser-entry")), false);
	for (const file of files.filter((candidate) => candidate.endsWith(".js"))) {
		const content = await readFile(file, "utf8");
		assert.equal(content.includes(FAKE_MODEL_MARKER), false);
		assert.equal(content.includes("LLM_WIKI_BROWSER_"), false);
	}
}

async function collectFiles(path: string): Promise<string[]> {
	const entries = await readdir(path, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const entryPath = join(path, entry.name);
		if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
		else files.push(entryPath);
	}
	return files;
}
