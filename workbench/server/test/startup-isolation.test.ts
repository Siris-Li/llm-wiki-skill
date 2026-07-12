import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SERVER_ENTRY = join(REPO_ROOT, "workbench/server/dist/index.js");
const TRUSTED_ORIGIN = "http://127.0.0.1:5180";
const TOKEN_HEADER = "X-LLM-Wiki-Workbench-Token";
const START_TIMEOUT_MS = 20_000;
const OPERATION_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;

interface RunningServer {
	child: ChildProcess;
	output: () => string;
	stop: () => Promise<void>;
}

interface SpawnedServer {
	child: ChildProcess;
	output: () => string;
}

test(
	"formal server starts in an isolated HOME, rotates its token, restores state, and cleans up",
	{ timeout: 60_000 },
	async (t) => {
		const sandbox = await mkdtemp(join(tmpdir(), "llm-wiki-startup-"));
		const home = join(sandbox, "home");
		const kbPath = join(home, "llm-wiki", "restored-kb");
		const appDir = join(home, ".llm-wiki-agent");
		const tokenFile = join(appDir, "runtime", "capability-token");
		const configFile = join(appDir, "config.json");
		const outsideMarker = join(sandbox, "outside-home.txt");
		const port = await availablePort();
		let running: RunningServer | undefined;

		await mkdir(kbPath, { recursive: true });
		await mkdir(appDir, { recursive: true });
		await writeFile(join(kbPath, ".wiki-schema.md"), "# isolated test schema\n");
		await writeFile(
			configFile,
			`${JSON.stringify({ version: 1, externalKnowledgeBases: [], lastUsedKbPath: kbPath }, null, 2)}\n`,
		);
		await mkdir(dirname(tokenFile), { recursive: true });
		await writeFile(tokenFile, "stale-token", { mode: 0o644 });
		await chmod(tokenFile, 0o644);
		await writeFile(outsideMarker, "must-not-change\n");
		await assert.rejects(
			stat(join(REPO_ROOT, "workbench/server/dist/test/support/isolation-guard.mjs")),
		);

		t.after(async () => {
			if (running) await running.stop().catch(() => undefined);
			await rm(sandbox, { recursive: true, force: true });
		});

		const environment = isolatedEnvironment(home, port);
		assert.equal(environment.OPENAI_API_KEY, undefined);
		assert.equal(environment.ANTHROPIC_API_KEY, undefined);
		assert.equal(environment.PI_CONFIG_DIR, undefined);
		assert.equal(environment.XDG_CONFIG_HOME, undefined);
		assert.equal(environment.HOME, home);
		await assert.rejects(stat(join(home, ".pi", "agent", "auth.json")));

		running = await startServer(environment);
		assert.match(running.output(), /ignoring unsafe HOST=0\.0\.0\.0/);
		assert.match(running.output(), new RegExp(`listening on http://127\\.0\\.0\\.1:${port}`));

		const firstToken = await readFile(tokenFile, "utf8");
		assert.notEqual(firstToken, "stale-token");
		assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);

		const restored = await apiRequest(port, firstToken, TRUSTED_ORIGIN);
		assert.equal(restored.status, 200);
		const restoredBody = (await restored.json()) as {
			ok: boolean;
			data?: { active?: { kb?: { path?: string } } };
		};
		assert.equal(restoredBody.ok, true);
		assert.equal(restoredBody.data?.active?.kb?.path, kbPath);

		const diskBeforeRead = await snapshotTree(home);
		const outsideBeforeRead = await readFile(outsideMarker, "utf8");
		const untrusted = await apiRequest(port, firstToken, "https://untrusted.example");
		assert.equal(untrusted.status, 403);
		assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
		assert.doesNotMatch(await untrusted.text(), /restored-kb|llm-wiki-startup-/);
		const trustedRead = await apiRequest(port, firstToken, TRUSTED_ORIGIN);
		assert.equal(trustedRead.status, 200);
		await trustedRead.arrayBuffer();
		assert.deepEqual(await snapshotTree(home), diskBeforeRead);
		assert.equal(await readFile(outsideMarker, "utf8"), outsideBeforeRead);

		await running.stop();
		running = undefined;
		await assertPortReleased(port);

		running = await startServer(environment);
		const secondToken = await readFile(tokenFile, "utf8");
		assert.notEqual(secondToken, firstToken);
		assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);

		const staleCredential = await apiRequest(port, firstToken, TRUSTED_ORIGIN);
		assert.equal(staleCredential.status, 403);
		const recoveredAgain = await apiRequest(port, secondToken, TRUSTED_ORIGIN);
		assert.equal(recoveredAgain.status, 200);
		const recoveredAgainBody = (await recoveredAgain.json()) as {
			data?: { active?: { kb?: { path?: string } } };
		};
		assert.equal(recoveredAgainBody.data?.active?.kb?.path, kbPath);

		await running.stop();
		running = undefined;
		await assertPortReleased(port);

		const portBlocker = createServer();
		await listen(portBlocker, port);
		let failedStart: Awaited<ReturnType<typeof expectFailedStart>>;
		try {
			failedStart = await expectFailedStart(environment);
		} finally {
			await closeServer(portBlocker);
		}
		assert.notEqual(failedStart.code, 0);
		assert.equal(failedStart.signal, null);
		assert.match(failedStart.output, /EADDRINUSE/);
		await assertPortReleased(port);

		running = await startServer(environment);
		await running.stop();
		running = undefined;
		await assertPortReleased(port);
	},
);

function isolatedEnvironment(home: string, port: number): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {
		HOME: home,
		HOST: "0.0.0.0",
		PORT: String(port),
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		TMPDIR: join(home, "tmp"),
		LANG: "C.UTF-8",
		LLM_WIKI_ISOLATED_WRITE_ROOT: home,
		NODE_OPTIONS: `--import=${join(import.meta.dirname, "support/isolation-guard.mjs")}`,
	};
	if (process.platform === "win32" && process.env.SystemRoot) {
		environment.SystemRoot = process.env.SystemRoot;
	}
	return environment;
}

async function startServer(environment: NodeJS.ProcessEnv): Promise<RunningServer> {
	await mkdir(environment.TMPDIR!, { recursive: true });
	const spawned = spawnServer(environment);
	const { child, output } = spawned;

	try {
		await waitUntil(
			() => output().includes("listening on http://"),
			START_TIMEOUT_MS,
			() => `server did not start\n${output()}`,
			child,
		);
	} catch (error) {
		signalProcessTree(child, "SIGKILL");
		await waitForExit(child, 1_000, output).catch(() => undefined);
		throw error;
	}

	let stopped = false;
	return {
		child,
		output,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			const exit = waitForExit(child, STOP_TIMEOUT_MS, output);
			signalProcessTree(child, "SIGTERM");
			const result = await exit;
			assert.equal(result.signal, null, `server was killed instead of shutting down\n${output()}`);
			assert.equal(result.code, 0, `server exited unsuccessfully\n${output()}`);
		},
	};
}

function spawnServer(environment: NodeJS.ProcessEnv): SpawnedServer {
	const child = spawn(process.execPath, [SERVER_ENTRY], {
		cwd: REPO_ROOT,
		detached: process.platform !== "win32",
		env: environment,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		output += chunk;
	});
	child.stderr?.on("data", (chunk: string) => {
		output += chunk;
	});
	return {
		child,
		output: () => output,
	};
}

async function expectFailedStart(
	environment: NodeJS.ProcessEnv,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
	const { child, output } = spawnServer(environment);
	const result = await waitForExit(child, START_TIMEOUT_MS, output);
	return { ...result, output: output() };
}

async function apiRequest(port: number, token: string, origin: string): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/api/knowledge-base`, {
		headers: {
			[TOKEN_HEADER]: token,
			origin,
			"sec-fetch-site": origin === TRUSTED_ORIGIN ? "same-origin" : "cross-site",
		},
		signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
	});
}

async function availablePort(): Promise<number> {
	const server = createServer();
	await listen(server, 0);
	const address = server.address();
	assert(address && typeof address === "object");
	const port = address.port;
	await closeServer(server);
	return port;
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolvePromise);
	});
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		server.close((error) => (error ? reject(error) : resolvePromise()));
	});
}

async function assertPortReleased(port: number): Promise<void> {
	await assert.rejects(
		fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(500),
		}),
	);
}

async function waitUntil(
	predicate: () => boolean,
	timeoutMs: number,
	errorMessage: () => string,
	child: ChildProcess,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`server exited before readiness\n${errorMessage()}`);
		}
		if (Date.now() >= deadline) throw new Error(errorMessage());
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
	}
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
			signalProcessTree(child, "SIGKILL");
			reject(new Error(`server did not stop within ${timeoutMs}ms\n${output()}`));
		}, timeoutMs);
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			resolvePromise({ code, signal });
		});
	});
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
	try {
		if (process.platform === "win32") child.kill(signal);
		else process.kill(-child.pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
	const snapshot: Record<string, string> = {};
	async function visit(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const absolutePath = join(current, entry.name);
			const relativePath = absolutePath.slice(root.length + 1);
			if (entry.isDirectory()) {
				snapshot[`${relativePath}/`] = "directory";
				await visit(absolutePath);
			} else if (entry.isFile()) {
				const content = await readFile(absolutePath);
				const mode = (await stat(absolutePath)).mode & 0o777;
				snapshot[relativePath] = `${mode.toString(8)}:${createHash("sha256").update(content).digest("hex")}`;
			}
		}
	}
	await visit(root);
	return snapshot;
}
