import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
	createMinimalEnvironment,
	QUALITY_STEPS,
	runInvocation,
	sanitizeOutput,
	TOTAL_TIMEOUT_MS,
} from "./run-quality-and-tests.mjs";

const REQUIRED_STEPS = [
	"build-contracts",
	"build-graph",
	"build-server",
	"build-web",
	"boundary-negative-controls",
	"boundaries",
	"contracts",
	"startup-isolation",
	"route-registry-negative-controls",
	"server",
	"web-unit",
	"web-dom",
	"graph",
	"types-contracts",
	"types-graph",
	"types-server",
	"types-web",
	"web-lint",
];

test("quality entrypoint covers every required check in a stable sequence", () => {
	assert.deepEqual(QUALITY_STEPS.map((step) => step.id), REQUIRED_STEPS);
	assert.ok(TOTAL_TIMEOUT_MS > 0);
	assert.ok(QUALITY_STEPS.every((step) => step.timeoutMs > 0));
	assert.deepEqual(
		QUALITY_STEPS.filter((step) => step.producesSharedArtifacts).map((step) => step.id),
		["build-contracts", "build-graph"],
	);
	assert.ok(QUALITY_STEPS.flatMap((step) => step.commands).every((item) =>
		item.command !== "npm" && item.command !== "npm.cmd"
	));
	for (const stepId of ["build-web", "types-web"]) {
		const step = QUALITY_STEPS.find((candidate) => candidate.id === stepId);
		assert.ok(step.commands.some((item) => item.args.includes("--force")));
	}
});

test("quality children receive only the allowlisted environment", () => {
	const environment = createMinimalEnvironment({
		HOME: "/real/home",
		PATH: "/bin",
		TMPDIR: "/tmp",
		CI: "true",
		OPENAI_API_KEY: "secret",
		ANTHROPIC_API_KEY: "secret",
		XDG_CONFIG_HOME: "/real/config",
		NPM_TOKEN: "secret",
	}, "/tmp/quality-home");

	assert.equal(environment.HOME, "/tmp/quality-home");
	assert.equal(environment.XDG_CONFIG_HOME, "/tmp/quality-home/.config");
	assert.equal(environment.PATH, "/bin");
	assert.equal(environment.CI, "true");
	assert.equal(environment.OPENAI_API_KEY, undefined);
	assert.equal(environment.ANTHROPIC_API_KEY, undefined);
	assert.equal(environment.NPM_TOKEN, undefined);
	assert.deepEqual(Object.keys(environment).sort(), [
		"CI",
		"HOME",
		"LANG",
		"PATH",
		"TMPDIR",
		"XDG_CONFIG_HOME",
	]);
});

test("failure output removes local paths and token-shaped values", () => {
	const cleaned = sanitizeOutput(
		"/repo/private /sandbox/data /home/person sk-abcdefghijklmnop github_pat_abcdefghijklmnop",
		{ repoRoot: "/repo", sandbox: "/sandbox", home: "/home/person" },
	);
	assert.equal(cleaned, "<repo>/private <sandbox>/data <home> <redacted-token> <redacted-token>");
});

test("timed out commands terminate their process group", { skip: process.platform === "win32" }, async () => {
	const script = [
		'import { spawn } from "node:child_process";',
		"const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);",
		"console.log(child.pid);",
		"setInterval(() => {}, 1000);",
	].join("\n");
	const result = await runInvocation(
		{ command: process.execPath, args: ["--input-type=module", "-e", script], cwd: process.cwd() },
		process.env,
		50,
	);
	assert.equal(result.timedOut, true);
	const childPid = Number(result.output.trim());
	assert.ok(Number.isInteger(childPid));
	await assertProcessStops(childPid);
});

test("GitHub quality check calls the shared entrypoint with minimal permissions", async () => {
	const workflow = await readFile(new URL("../../.github/workflows/quality-and-tests.yml", import.meta.url), "utf8");
	assert.match(workflow, /pull_request:/);
	assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
	assert.doesNotMatch(workflow, /paths(?:-ignore)?:/);
	assert.match(workflow, /permissions:\s*\n\s*contents: read/);
	assert.match(workflow, /quality-and-tests:\s*\n/);
	assert.match(workflow, /timeout-minutes:/);
	assert.match(workflow, /run: npm ci/);
	assert.match(workflow, /run: npm run quality-and-tests/);
	assert.match(workflow, /if: failure\(\)/);
	assert.match(workflow, /retention-days: 7/);
});

async function assertProcessStops(pid) {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if (error?.code === "ESRCH") return;
			throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail(`process ${pid} survived quality timeout in ${path.basename(process.cwd())}`);
}
