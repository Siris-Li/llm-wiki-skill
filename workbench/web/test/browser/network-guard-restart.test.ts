import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	REPO_ROOT,
	closeBrowserResources,
	createNetworkGuardLaunch,
	startNetworkGuardedProcess,
	startProcess,
	stopProcess,
	verifyNetworkGuardLaunch,
} from "./support/browser-harness";
import type { Browser, BrowserContext } from "playwright";

const LIVE_CHILD_SOURCE = "const s=require('node:net').createServer();process.on('SIGTERM',()=>s.close(()=>process.exit(0)));s.listen(0,'127.0.0.1',()=>console.log('ready'))";

test("every guarded process launch produces fresh verified evidence", async (t) => {
	const sandbox = await mkdtemp(join(tmpdir(), "llm-wiki-browser-network-guard-"));
	const probeFile = join(sandbox, "server-network-probe.json");
	let running: Awaited<ReturnType<typeof startNetworkGuardedProcess>> | undefined;
	t.after(async () => {
		if (running) await stopProcess(running).catch(() => undefined);
		await rm(sandbox, { recursive: true, force: true });
	});

	for (let launchIndex = 0; launchIndex < 2; launchIndex += 1) {
		running = await startNetworkGuardedProcess(
			process.execPath,
			["-e", LIVE_CHILD_SOURCE],
			REPO_ROOT,
			{
				HOME: sandbox,
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				TMPDIR: sandbox,
				LANG: "C.UTF-8",
			},
			(output) => output.includes("ready"),
			"guarded controlled launch",
			probeFile,
		);
		await stopProcess(running);
		running = undefined;
	}
});

test("a restarted process cannot reuse stale network guard evidence", async (t) => {
	const sandbox = await mkdtemp(join(tmpdir(), "llm-wiki-browser-network-guard-"));
	const probeFile = join(sandbox, "server-network-probe.json");
	const runningProcesses: Array<Awaited<ReturnType<typeof startProcess>>> = [];
	t.after(async () => {
		for (const running of runningProcesses) await stopProcess(running).catch(() => undefined);
		await rm(sandbox, { recursive: true, force: true });
	});

	await writeFile(probeFile, "BLOCKED");
	const previousLaunch = await createNetworkGuardLaunch(probeFile);
	const currentLaunch = await createNetworkGuardLaunch(probeFile);
	assert.notEqual(previousLaunch.probeFile, currentLaunch.probeFile);
	await writeFile(previousLaunch.probeFile, JSON.stringify({
		generation: previousLaunch.generation,
		result: "BLOCKED",
	}));

	const processWithoutGuard = await startProcess(
		process.execPath,
		["-e", LIVE_CHILD_SOURCE],
		REPO_ROOT,
		{
			HOME: sandbox,
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			TMPDIR: sandbox,
			LANG: "C.UTF-8",
		},
		(output) => output.includes("ready"),
		"controlled restart without network guard",
	);
	runningProcesses.push(processWithoutGuard);

	await assert.rejects(
		verifyNetworkGuardLaunch(currentLaunch, processWithoutGuard),
		/current launch did not produce valid network guard evidence/,
	);
	assert.equal(processWithoutGuard.child.exitCode, null);
	assert.equal(processWithoutGuard.child.signalCode, null);
	await stopProcess(processWithoutGuard);
	runningProcesses.pop();
});

test("connected browser owns context disposal during cleanup", async () => {
	const calls: string[] = [];
	const context = {
		close: async () => { calls.push("context"); },
	} as unknown as BrowserContext;
	const browser = {
		close: async () => { calls.push("browser"); },
	} as unknown as Browser;

	await closeBrowserResources({ context, browser });

	assert.deepEqual(calls, ["browser"]);
});

test("standalone browser context is still closed", async () => {
	const calls: string[] = [];
	const context = {
		close: async () => { calls.push("context"); },
	} as unknown as BrowserContext;

	await closeBrowserResources({ context });

	assert.deepEqual(calls, ["context"]);
});
