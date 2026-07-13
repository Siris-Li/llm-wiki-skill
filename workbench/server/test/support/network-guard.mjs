import fs from "node:fs";
import net from "node:net";

const probeFile = process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_FILE;
const probeTarget = process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_TARGET;
delete process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_FILE;
delete process.env.LLM_WIKI_BROWSER_NETWORK_PROBE_TARGET;

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
	const destination = connectionDestination(args);
	if (destination && !isLoopback(destination)) {
		throw new Error(`browser test attempted an external connection: ${destination}`);
	}
	return originalConnect.apply(this, args);
};

if (probeFile && probeTarget) {
	const target = new URL(probeTarget);
	const socket = new net.Socket();
	let result = "ALLOWED";
	try {
		socket.connect({ host: target.hostname, port: Number(target.port) });
	} catch {
		result = "BLOCKED";
	} finally {
		socket.destroy();
	}
	fs.writeFileSync(probeFile, result);
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
