import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { isAbsolute, relative, resolve } from "node:path";

const allowedRoot = resolveRequiredPath(
	process.env.LLM_WIKI_ISOLATED_WRITE_ROOT,
	"LLM_WIKI_ISOLATED_WRITE_ROOT",
);

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
	wrapPathMutation(fs.promises, name);
}
for (const name of ["copyFile", "cp", "link", "rename", "symlink"]) {
	wrapSecondPath(fs, name);
	wrapSecondPath(fs.promises, name);
}
wrapOpen(fs, "open");
wrapOpen(fs, "openSync");
wrapOpen(fs.promises, "open");
syncBuiltinESMExports();

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
	const destination = connectionDestination(args);
	if (destination && !isLoopback(destination)) {
		throw new Error(`isolated startup attempted an external connection: ${destination}`);
	}
	return originalConnect.apply(this, args);
};

function wrapPathMutation(target, name) {
	const original = target[name];
	if (typeof original !== "function") return;
	target[name] = function guardedPathMutation(path, ...args) {
		assertWritablePath(path);
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
		if (typeof flags === "string" && /[+awx]/.test(flags)) assertWritablePath(path);
		if (typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0) {
			assertWritablePath(path);
		}
		return original.call(this, path, flags, ...args);
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
