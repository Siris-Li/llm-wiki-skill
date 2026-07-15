import fs from "node:fs";
import net from "node:net";

const probeFile = process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_FILE;
const probeTarget = process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_TARGET;
const probeGeneration = process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_GENERATION;
delete process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_FILE;
delete process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_TARGET;
delete process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_GENERATION;

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
	const destination = connectionDestination(args);
	if (destination && !isLoopback(destination)) {
		throw new Error(`browser test attempted an external connection: ${destination}`);
	}
	return originalConnect.apply(this, args);
};

if (probeFile && probeTarget && probeGeneration) {
	const target = new URL(probeTarget);
	const options = { host: target.hostname, port: Number(target.port) };
	const attempts = [
		() => new net.Socket().connect(options),
		() => new net.Socket().connect(options.port, options.host),
		() => net.connect(options),
		() => net.connect(options.port, options.host),
		() => net.createConnection(options),
		() => net.createConnection(options.port, options.host),
	];
	const result = attempts.every(connectionIsBlocked) ? "BLOCKED" : "ALLOWED";
	fs.writeFileSync(probeFile, JSON.stringify({ generation: probeGeneration, result }));
}

function connectionDestination(args) {
	let normalized = args;
	while (normalized.length === 1 && Array.isArray(normalized[0])) normalized = normalized[0];
	const first = normalized[0];
	if (typeof first === "object" && first !== null) {
		if (typeof first.path === "string") return null;
		return typeof first.host === "string" ? first.host : "localhost";
	}
	if (typeof first === "number") {
		return typeof normalized[1] === "string" ? normalized[1] : "localhost";
	}
	return null;
}

function connectionIsBlocked(connect) {
	let socket;
	try {
		socket = connect();
		socket.on("error", () => undefined);
		return false;
	} catch {
		return true;
	} finally {
		socket?.destroy();
	}
}

function isLoopback(host) {
	const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
	return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
