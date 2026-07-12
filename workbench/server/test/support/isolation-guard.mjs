import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { isAbsolute, relative, resolve } from "node:path";

const allowedRoot = resolveRequiredPath(
	process.env.LLM_WIKI_ISOLATED_WRITE_ROOT,
	"LLM_WIKI_ISOLATED_WRITE_ROOT",
);
const deniedReads = new Set(
	parsePathList(process.env.LLM_WIKI_ISOLATED_DENIED_READS).map((path) => resolve(path)),
);
const probeFile = process.env.LLM_WIKI_ISOLATED_PROBE_FILE;
const probeOutside = process.env.LLM_WIKI_ISOLATED_PROBE_OUTSIDE;
const childSandboxProfile = process.env.LLM_WIKI_ISOLATED_CHILD_PROFILE;
delete process.env.LLM_WIKI_ISOLATED_DENIED_READS;
delete process.env.LLM_WIKI_ISOLATED_PROBE_FILE;
delete process.env.LLM_WIKI_ISOLATED_PROBE_OUTSIDE;
delete process.env.LLM_WIKI_ISOLATED_CHILD_PROFILE;

function assertReadablePath(value) {
	if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof URL)) {
		return;
	}
	const path = resolve(value instanceof URL ? value.pathname : value.toString());
	if (deniedReads.has(path)) {
		throw new Error(`isolated startup attempted a denied read: ${path}`);
	}
}

function assertWritablePath(value) {
	if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof URL)) {
		return;
	}
	const path = resolve(value instanceof URL ? value.pathname : value.toString());
	const fromRoot = relative(allowedRoot, path);
	if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) return;
	throw new Error(`isolated startup attempted a write outside HOME: ${path}`);
}

for (const name of [
	"appendFile",
	"chmod",
	"chown",
	"copyFile",
	"cp",
	"link",
	"lchmod",
	"lchown",
	"lutimes",
	"mkdir",
	"mkdtemp",
	"rename",
	"rm",
	"rmdir",
	"symlink",
	"truncate",
	"unlink",
	"utimes",
	"writeFile",
]) {
	wrapPathMutation(fs, name);
	wrapPathMutation(fs, `${name}Sync`);
	wrapPathMutation(fs.promises, name);
}
for (const name of ["access", "lstat", "readFile", "readlink", "realpath", "stat"]) {
	wrapPathRead(fs, name);
	wrapPathRead(fs, `${name}Sync`);
	wrapPathRead(fs.promises, name);
}
wrapPathRead(fs, "createReadStream");
for (const name of ["copyFile", "cp", "link", "rename", "symlink"]) {
	wrapSecondPath(fs, name);
	wrapSecondPath(fs, `${name}Sync`);
	wrapSecondPath(fs.promises, name);
}
wrapOpen(fs, "open");
wrapOpen(fs, "openSync");
wrapOpen(fs.promises, "open");
if (childSandboxProfile) wrapChildProcesses(childSandboxProfile);
syncBuiltinESMExports();

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
	const destination = connectionDestination(args);
	if (destination && !isLoopback(destination)) {
		throw new Error(`isolated startup attempted an external connection: ${destination}`);
	}
	return originalConnect.apply(this, args);
};
runIsolationProbes();

function wrapPathMutation(target, name) {
	const original = target[name];
	if (typeof original !== "function") return;
	target[name] = function guardedPathMutation(path, ...args) {
		assertWritablePath(path);
		return original.call(this, path, ...args);
	};
}

function wrapPathRead(target, name) {
	const original = target[name];
	if (typeof original !== "function") return;
	target[name] = function guardedPathRead(path, ...args) {
		assertReadablePath(path);
		return original.call(this, path, ...args);
	};
}

function wrapSecondPath(target, name) {
	const current = target[name];
	if (typeof current !== "function") return;
	target[name] = function guardedSecondPath(source, destination, ...args) {
		assertWritablePath(destination);
		return current.call(this, source, destination, ...args);
	};
}

function wrapOpen(target, name) {
	const original = target[name];
	if (typeof original !== "function") return;
	target[name] = function guardedOpen(path, flags, ...args) {
		assertReadablePath(path);
		if (typeof flags === "string" && /[+awx]/.test(flags)) assertWritablePath(path);
		if (typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0) {
			assertWritablePath(path);
		}
		return original.call(this, path, flags, ...args);
	};
}

function runIsolationProbes() {
	if (!probeFile || !probeOutside || deniedReads.size < 2) return;
	const [realAppPath, realCredentialsPath] = deniedReads;
	const result = {
		externalNetwork: probeExternalNetwork(),
		outsideWrite: probeOperation(() => fs.writeFileSync(probeOutside, "forbidden")),
		realAppRead: probeOperation(() => fs.readFileSync(realAppPath)),
		realCredentialsRead: probeOperation(() => fs.readFileSync(realCredentialsPath)),
	};
	fs.writeFileSync(probeFile, JSON.stringify(result));
}

function probeExternalNetwork() {
	const socket = new net.Socket();
	try {
		socket.connect({ host: "github.com", port: 443 });
		socket.destroy();
		return "ALLOWED";
	} catch {
		socket.destroy();
		return "BLOCKED";
	}
}

function probeOperation(operation) {
	try {
		operation();
		return "ALLOWED";
	} catch {
		return "BLOCKED";
	}
}

function wrapChildProcesses(profile) {
	if (process.platform !== "darwin") return;
	const sandboxExec = "/usr/bin/sandbox-exec";
	const originalSpawn = childProcess.spawn;
	const originalExecFile = childProcess.execFile;
	childProcess.spawn = function guardedSpawn(command, args, options) {
		const commandArgs = Array.isArray(args) ? args : [];
		const commandOptions = Array.isArray(args) ? options : args;
		return originalSpawn.call(
			this,
			sandboxExec,
			["-f", profile, command, ...commandArgs],
			commandOptions,
		);
	};
	childProcess.execFile = function guardedExecFile(file, ...rest) {
		const args = Array.isArray(rest[0]) ? rest.shift() : [];
		return originalExecFile.call(
			this,
			sandboxExec,
			["-f", profile, file, ...args],
			...rest,
		);
	};
}

function connectionDestination(args) {
	const first = args[0];
	if (typeof first === "object" && first !== null) {
		if (typeof first.path === "string") return null;
		return typeof first.host === "string" ? first.host : "localhost";
	}
	if (typeof first === "number") {
		return typeof args[1] === "string" ? args[1] : "localhost";
	}
	return null;
}

function isLoopback(host) {
	const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
	return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveRequiredPath(value, name) {
	if (!value) throw new Error(`${name} is required by the isolated startup guard`);
	return resolve(value);
}

function parsePathList(value) {
	if (!value) return [];
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
		throw new Error("LLM_WIKI_ISOLATED_DENIED_READS must be a JSON string array");
	}
	return parsed;
}
