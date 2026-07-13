import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NODE = process.execPath;
const TSC = path.join(REPO_ROOT, "node_modules/typescript/bin/tsc");
const VITE = path.join(REPO_ROOT, "node_modules/vite/bin/vite.js");
const ESLINT = path.join(REPO_ROOT, "node_modules/eslint/bin/eslint.js");
const FAILURE_DIR = path.join(REPO_ROOT, ".tmp/quality-and-tests");
const COMMAND_TIMEOUT_MS = 120_000;
const SLOW_TEST_TIMEOUT_MS = 240_000;
const STOP_GRACE_MS = 250;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export const TOTAL_TIMEOUT_MS = 15 * 60_000;

const command = (args, cwd = REPO_ROOT) => ({ command: NODE, args, cwd });
const nodeTest = (...files) => command(["--import", "tsx", "--test", ...files]);

export const QUALITY_STEPS = [
	{
		id: "build-contracts",
		producesSharedArtifacts: true,
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command([TSC, "-p", "packages/workbench-contracts/tsconfig.json"])],
	},
	{
		id: "build-graph",
		producesSharedArtifacts: true,
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [
			command([VITE, "build"], path.join(REPO_ROOT, "packages/graph-engine")),
			command([TSC, "-p", "packages/graph-engine/tsconfig.json", "--emitDeclarationOnly"]),
		],
	},
	{
		id: "build-server",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [
			command(["-e", "require('node:fs').rmSync('workbench/server/dist',{recursive:true,force:true})"]),
			command([TSC, "-p", "workbench/server/tsconfig.build.json"]),
		],
	},
	{
		id: "build-web",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [
			command([TSC, "-b", "workbench/web/tsconfig.json", "--force"]),
			command([VITE, "build"], path.join(REPO_ROOT, "workbench/web")),
		],
	},
	{
		id: "boundary-negative-controls",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [
			nodeTest("workbench/scripts/check-workbench-boundaries.test.mjs"),
			command(["--test", "workbench/scripts/run-quality-and-tests.test.mjs"]),
		],
	},
	{
		id: "boundaries",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command(["--import", "tsx", "workbench/scripts/check-workbench-boundaries.mjs"])],
	},
	{
		id: "contracts",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [nodeTest("packages/workbench-contracts/test/*.test.ts")],
	},
	{
		id: "startup-isolation",
		timeoutMs: SLOW_TEST_TIMEOUT_MS,
		commands: [nodeTest("workbench/server/test/startup-isolation.test.ts")],
	},
	{
		id: "route-registry-negative-controls",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [nodeTest("workbench/server/test/route-registry-parity.test.ts")],
	},
	{
		id: "server",
		timeoutMs: SLOW_TEST_TIMEOUT_MS,
		commands: [nodeTest("workbench/server/src/**/*.test.ts")],
	},
	{
		id: "web-unit",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [nodeTest("workbench/web/test/*.test.ts")],
	},
	{
		id: "web-dom",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command([
			"--test-concurrency=1",
			"--import",
			"tsx",
			"--import",
			"./workbench/web/test/setup-dom.ts",
			"--test",
			"workbench/web/test/*.test.tsx",
		])],
	},
	{
		id: "graph",
		timeoutMs: SLOW_TEST_TIMEOUT_MS,
		commands: [nodeTest("packages/graph-engine/test/*.test.ts")],
	},
	{
		id: "types-contracts",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command([TSC, "-p", "packages/workbench-contracts/tsconfig.json", "--noEmit"])],
	},
	{
		id: "types-graph",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command([TSC, "-p", "packages/graph-engine/tsconfig.json", "--noEmit"])],
	},
	{
		id: "types-server",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command([TSC, "-p", "workbench/server/tsconfig.test.json", "--noEmit"])],
	},
	{
		id: "types-web",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [
			command([TSC, "-b", "workbench/web/tsconfig.json", "--noEmit", "--force"]),
			command([TSC, "-p", "workbench/web/tsconfig.browser.json", "--noEmit"]),
		],
	},
	{
		id: "web-lint",
		timeoutMs: COMMAND_TIMEOUT_MS,
		commands: [command([ESLINT, "."], path.join(REPO_ROOT, "workbench/web"))],
	},
];

export function createMinimalEnvironment(source, sandboxHome) {
	const environment = {
		HOME: sandboxHome,
		XDG_CONFIG_HOME: path.join(sandboxHome, ".config"),
		PATH: source.PATH ?? "/usr/bin:/bin",
		TMPDIR: source.TMPDIR ?? tmpdir(),
		LANG: "C.UTF-8",
	};
	if (source.CI) environment.CI = source.CI;
	if (process.platform === "win32") {
		for (const name of ["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"]) {
			if (source[name]) environment[name] = source[name];
		}
	}
	return environment;
}

export async function runInvocation(invocation, environment, timeoutMs, onSpawn = () => undefined) {
	const child = spawn(invocation.command, invocation.args, {
		cwd: invocation.cwd,
		detached: process.platform !== "win32",
		env: environment,
		stdio: ["ignore", "pipe", "pipe"],
	});
	onSpawn(child);
	let output = "";
	const append = (chunk) => {
		output = `${output}${chunk}`.slice(-MAX_CAPTURE_BYTES);
	};
	child.stdout?.on("data", append);
	child.stderr?.on("data", append);
	let timedOut = false;
	let termination;
	const timer = setTimeout(() => {
		timedOut = true;
		termination = terminateProcessTree(child);
	}, timeoutMs);
	const result = await waitForExit(child).finally(() => clearTimeout(timer));
	if (timedOut) await termination;
	else if (result.code !== 0) await terminateProcessTree(child);
	return { ...result, timedOut, output };
}

export function sanitizeOutput(value, { repoRoot = REPO_ROOT, sandbox, home = homedir() }) {
	return value
		.replaceAll(repoRoot, "<repo>")
		.replaceAll(sandbox, "<sandbox>")
		.replaceAll(home, "<home>")
		.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_\-]{12,}\b/g, "<redacted-token>");
}

async function main() {
	await rm(FAILURE_DIR, { recursive: true, force: true });
	const sandbox = await mkdtemp(path.join(tmpdir(), "llm-wiki-quality-"));
	const sandboxHome = path.join(sandbox, "home");
	await mkdir(path.join(sandboxHome, ".config"), { recursive: true });
	const environment = createMinimalEnvironment(process.env, sandboxHome);
	const deadline = Date.now() + TOTAL_TIMEOUT_MS;
	const completed = [];
	let failureOutput = "";
	let activeChild;
	let activeTermination;
	let interrupted;
	const stopForSignal = (signal) => {
		interrupted = signal;
		if (activeChild) activeTermination = terminateProcessTree(activeChild);
	};
	const interruptHandler = () => stopForSignal("SIGINT");
	const terminateHandler = () => stopForSignal("SIGTERM");
	process.once("SIGINT", interruptHandler);
	process.once("SIGTERM", terminateHandler);

	try {
		for (const step of QUALITY_STEPS) {
			const stepDeadline = Math.min(deadline, Date.now() + step.timeoutMs);
			process.stdout.write(`\n[quality-and-tests] ${step.id}\n`);
			for (const invocation of step.commands) {
				const remainingMs = stepDeadline - Date.now();
				if (remainingMs <= 0) throw new Error(`${step.id} exceeded its time limit`);
				const result = await runInvocation(invocation, environment, remainingMs, (child) => {
					activeChild = child;
				});
				activeChild = undefined;
				failureOutput = sanitizeOutput(result.output, { sandbox });
				if (failureOutput) process.stdout.write(failureOutput.endsWith("\n") ? failureOutput : `${failureOutput}\n`);
				if (activeTermination) await activeTermination;
				if (interrupted) throw new Error(`quality-and-tests interrupted by ${interrupted}`);
				if (result.timedOut) throw new Error(`${step.id} exceeded its time limit`);
				if (result.code !== 0) throw new Error(`${step.id} failed with exit code ${result.code ?? result.signal}`);
			}
			completed.push(step.id);
			failureOutput = "";
		}
		process.stdout.write("\n[quality-and-tests] all checks passed\n");
	} catch (error) {
		if (activeChild) await terminateProcessTree(activeChild);
		const message = sanitizeOutput(error instanceof Error ? error.stack ?? error.message : String(error), { sandbox });
		await mkdir(FAILURE_DIR, { recursive: true });
		await writeFile(
			path.join(FAILURE_DIR, "failure.log"),
			`passed: ${completed.join(", ")}\n\n${failureOutput}\n${message}\n`,
			"utf8",
		);
		console.error(message);
		process.exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : 1;
	} finally {
		process.off("SIGINT", interruptHandler);
		process.off("SIGTERM", terminateHandler);
		await rm(sandbox, { recursive: true, force: true });
	}
}

async function terminateProcessTree(child) {
	signalProcessTree(child, "SIGTERM");
	await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS));
	signalProcessTree(child, "SIGKILL");
	if (child.exitCode === null && child.signalCode === null) await waitForExit(child);
}

function waitForExit(child) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
	}
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
}

function signalProcessTree(child, signal) {
	if (!child.pid) return;
	try {
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		} else {
			process.kill(-child.pid, signal);
		}
	} catch (error) {
		if (error?.code !== "ESRCH") throw error;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
