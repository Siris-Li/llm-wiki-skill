const childProcess = require("node:child_process");
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");

const registry = process.env.LLM_WIKI_QUALITY_PROCESS_REGISTRY;
const originalSpawn = childProcess.spawn;
const originalFork = childProcess.fork;
const originalExecFile = childProcess.execFile;

function recordChild(child) {
	if (!registry || !child?.pid || process.platform === "win32") return child;
	const result = childProcess.spawnSync("ps", ["-p", String(child.pid), "-o", "pid=,ppid=,pgid=,lstart="], {
		encoding: "utf8",
	});
	if (result.error || result.status !== 0 || typeof result.stdout !== "string") return child;
	const [pidText, parentPidText, processGroupText, ...startedAtParts] = result.stdout.trim().split(/\s+/);
	const identity = {
		pid: Number(pidText),
		parentPid: Number(parentPidText),
		processGroup: Number(processGroupText),
		startedAt: startedAtParts.join(" "),
	};
	if (
		identity.pid > 1
		&& identity.parentPid === process.pid
		&& identity.processGroup > 0
		&& identity.startedAt
	) {
		fs.appendFileSync(registry, `${JSON.stringify(identity)}\n`, { encoding: "utf8", mode: 0o600 });
	}
	return child;
}

childProcess.spawn = function trackedSpawn(...args) {
	return recordChild(originalSpawn.apply(this, args));
};

childProcess.fork = function trackedFork(...args) {
	return recordChild(originalFork.apply(this, args));
};

childProcess.execFile = function trackedExecFile(...args) {
	return recordChild(originalExecFile.apply(this, args));
};

syncBuiltinESMExports();
