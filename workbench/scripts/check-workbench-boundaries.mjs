import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ENDPOINT_REGISTRY } from "../../packages/workbench-contracts/src/endpoints.ts";

const WEB_FETCH_FILES = new Set([
	"workbench/web/src/lib/api/client.ts",
	"workbench/web/src/lib/api/prompt.ts",
	"workbench/web/src/lib/api/batch-digest.ts",
	"workbench/web/src/lib/api/legacy.ts",
]);

const REMAINING_LEGACY_ENDPOINTS = new Set([
	"POST /api/echo",
	"POST /api/knowledge-bases/new",
	"POST /api/knowledge-bases/init-existing",
	"GET /api/commands",
	"POST /api/system/choose-directory",
	"POST /api/auth/set",
	"POST /api/auth/test",
]);
const REMAINING_LEGACY_PATHS = new Set(
	[...REMAINING_LEGACY_ENDPOINTS].map((endpoint) => endpoint.slice(endpoint.indexOf(" ") + 1)),
);

async function sourceFiles(directory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	const files = [];
	for (const entry of entries) {
		if (entry.name === "dist" || entry.name === "node_modules") continue;
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
		else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(target);
	}
	return files;
}

function importSpecifiers(source) {
	const specifiers = [];
	const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
	const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
	for (const pattern of [staticImport, dynamicImport]) {
		for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
	}
	return specifiers;
}

function within(target, directory) {
	const relative = path.relative(directory, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function checkWorkbenchBoundaries(
	root,
	{ endpointRegistry = ENDPOINT_REGISTRY } = {},
) {
	const absoluteRoot = path.resolve(root);
	const findings = [];
	const report = (rule, file, message) => {
		findings.push({ rule, file: path.relative(absoluteRoot, file), message });
	};

	const webRoot = path.join(absoluteRoot, "workbench/web/src");
	const webPackageRoot = path.join(absoluteRoot, "workbench/web");
	const serverRoot = path.join(absoluteRoot, "workbench/server");
	const webFiles = await sourceFiles(webPackageRoot);
	const webSourceFiles = webFiles.filter((file) => within(file, webRoot));
	const legacyFacadeFile = path.join(webRoot, "lib/api.ts");
	if (webSourceFiles.includes(legacyFacadeFile)) {
		report(
			"web-legacy-api-facade",
			legacyFacadeFile,
			"the removed API compatibility facade cannot be reintroduced",
		);
	}
	for (const file of webSourceFiles) {
		const relative = path.relative(absoluteRoot, file);
		const source = await readFile(file, "utf8");
		if (/\bfetch\s*\(\s*["'`]\/api\//.test(source) && !WEB_FETCH_FILES.has(relative)) {
			report("web-direct-api-fetch", file, "direct /api fetch is restricted to low-level clients and SSE starters");
		}
		if (
			relative.startsWith("workbench/web/src/lib/api/") &&
			relative !== "workbench/web/src/lib/api/legacy.ts" &&
			(/\bas\s*\{[^}]{0,400}\bok\??\s*:\s*boolean[^}]{0,400}\b(?:items|error)\??\s*:/s.test(source) ||
				/\bjson\.(?:items|error)\b/.test(source))
		) {
			report("web-legacy-response-parser", file, "migrated API modules cannot parse legacy items/error responses");
		}
	}

	for (const file of webFiles) {
		const source = await readFile(file, "utf8");
		for (const specifier of importSpecifiers(source)) {
			const resolved = specifier.startsWith(".")
				? path.resolve(path.dirname(file), specifier)
				: null;
			if (
				specifier.includes("workbench/server") ||
				specifier.includes("@llm-wiki-agent/server") ||
				(resolved && within(resolved, serverRoot))
			) {
				report("web-server-internals-import", file, `web cannot import server internals: ${specifier}`);
			}
		}
	}
	const legacyClientFile = path.join(webRoot, "lib/api/legacy.ts");
	try {
		const legacyClient = await readFile(legacyClientFile, "utf8");
		for (const match of legacyClient.matchAll(/\bfetch\s*\(\s*["'`](\/api\/[^"'`$?]*)/g)) {
			const apiPath = match[1];
			const callStart = match.index ?? 0;
			const callPrefix = legacyClient.slice(callStart, callStart + 200);
			const method = callPrefix.match(/\bmethod\s*:\s*["']([A-Z]+)["']/)?.[1] ?? "GET";
			const endpoint = `${method} ${apiPath}`;
			if (!REMAINING_LEGACY_PATHS.has(apiPath) || !REMAINING_LEGACY_ENDPOINTS.has(endpoint)) {
				report(
					"web-legacy-endpoint-not-allowed",
					legacyClientFile,
					`legacy client cannot call migrated endpoint: ${endpoint}`,
				);
			}
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	const routesRoot = path.join(absoluteRoot, "workbench/server/src/routes");
	for (const file of await sourceFiles(routesRoot)) {
		const source = await readFile(file, "utf8");
		if (/\{\s*ok\s*:\s*false\s*,[\s\S]{0,240}?\berror\s*:/.test(source)) {
			report("server-route-legacy-error-envelope", file, "route modules must use code/message/details failure envelopes");
		}
	}

	const serverFiles = await sourceFiles(serverRoot);
	for (const file of [...webFiles, ...serverFiles]) {
		const source = await readFile(file, "utf8");
		for (const specifier of importSpecifiers(source)) {
			if (
				specifier.startsWith("@llm-wiki/workbench-contracts/") ||
				specifier.includes("workbench-contracts/src")
			) {
				report("contracts-root-entrypoint-only", file, `contracts must be imported from the package root: ${specifier}`);
			}
		}
	}

	const contractsRoot = path.join(absoluteRoot, "packages/workbench-contracts/src");
	for (const file of await sourceFiles(contractsRoot)) {
		const source = await readFile(file, "utf8");
		for (const specifier of importSpecifiers(source)) {
			if (specifier === "zod") continue;
			const resolved = specifier.startsWith(".")
				? path.resolve(path.dirname(file), specifier)
				: null;
			if (!resolved || !within(resolved, contractsRoot)) {
				report("contracts-forbidden-import", file, `contracts may only import zod or local contract modules: ${specifier}`);
			}
		}
	}
	const contractsPackageFile = path.join(
		absoluteRoot,
		"packages/workbench-contracts/package.json",
	);
	try {
		const packageJson = JSON.parse(await readFile(contractsPackageFile, "utf8"));
		const exportKeys = Object.keys(packageJson.exports ?? {});
		if (exportKeys.length !== 1 || exportKeys[0] !== ".") {
			report(
				"contracts-package-root-export-only",
				contractsPackageFile,
				"contracts package may only expose its root entrypoint",
			);
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	const registryFile = path.join(contractsRoot, "endpoints.ts");
	for (const entry of endpointRegistry) {
		if (entry.kind !== "legacy") continue;
		const key = `${entry.method} ${entry.path}`;
		if (!REMAINING_LEGACY_ENDPOINTS.has(key)) {
			report(
				"registry-unexpected-legacy-endpoint",
				registryFile,
				`migrated endpoint cannot return to legacy: ${key}`,
			);
		}
	}

	return findings.sort((a, b) =>
		`${a.file}:${a.rule}`.localeCompare(`${b.file}:${b.rule}`),
	);
}

async function main() {
	const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
	const findings = await checkWorkbenchBoundaries(root);
	if (findings.length === 0) {
		console.log("Workbench boundary check passed.");
		return;
	}
	for (const finding of findings) {
		console.error(`${finding.file}: ${finding.rule}: ${finding.message}`);
	}
	process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
