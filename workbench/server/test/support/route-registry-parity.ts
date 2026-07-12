import type {
	EndpointEntry,
	EndpointKind,
	EndpointSafety,
	HttpMethod,
} from "@llm-wiki/workbench-contracts";

export type EndpointMountSource = "createApp" | "startup";

export interface MountedEndpoint {
	readonly method: string;
	readonly path: string;
	readonly source: EndpointMountSource;
}

export interface TemporaryLegacyException {
	readonly finding: `FIND-${string}`;
	readonly issue: number;
}

export interface ApprovedAuxiliaryEndpoint {
	readonly id: `AUX-${string}`;
	readonly approval: string;
	readonly boundaryCheck: string;
}

export interface RuntimeEndpointDeclaration {
	readonly method: HttpMethod;
	readonly path: string;
	readonly kind: EndpointKind;
	readonly safety: EndpointSafety;
	readonly source: EndpointMountSource;
	readonly temporaryLegacyException?: TemporaryLegacyException;
	readonly approvedAuxiliary?: ApprovedAuxiliaryEndpoint;
}

interface AssembledRoute {
	readonly method: string;
	readonly path: string;
}

interface CollectMountedEndpointsOptions {
	readonly assembledRoutes: readonly AssembledRoute[];
	readonly runtimeRoutes: readonly AssembledRoute[];
}

interface AssertRouteRegistryParityOptions {
	readonly mounted: readonly MountedEndpoint[];
	readonly declared: readonly RuntimeEndpointDeclaration[];
	readonly registry: readonly EndpointEntry[];
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const MAX_TEMPORARY_LEGACY_EXCEPTIONS = 7;
const LEGACY_EXCEPTION_ISSUES = new Set([205, 206, 207]);

/**
 * Server-side declaration of route ownership and response/security intent.
 * It is deliberately independent from the contracts registry: the parity
 * check compares both sources instead of deriving one from the other.
 */
export const RUNTIME_ENDPOINT_DECLARATIONS = [
	{ method: "GET", path: "/api/health", kind: "migrated-json", safety: "public", source: "createApp" },
	{ method: "GET", path: "/api/events", kind: "sse", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/prompt", kind: "sse", safety: "state-changing", source: "createApp" },
	{ method: "POST", path: "/api/knowledge-bases/batch-digest", kind: "sse", safety: "state-changing", source: "createApp" },
	{ method: "GET", path: "/api/artifacts/:id/files/:filename", kind: "file-download", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/echo", kind: "legacy", safety: "read-only", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 207 } },
	{ method: "GET", path: "/api/knowledge-bases", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/knowledge-bases/external", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "POST", path: "/api/knowledge-bases/inspect", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "DELETE", path: "/api/knowledge-bases/external", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "POST", path: "/api/knowledge-bases/new", kind: "legacy", safety: "state-changing", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 206 } },
	{ method: "POST", path: "/api/knowledge-bases/init-existing", kind: "legacy", safety: "state-changing", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 206 } },
	{ method: "GET", path: "/api/knowledge-base", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/knowledge-base", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "DELETE", path: "/api/knowledge-base", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "GET", path: "/api/graph", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/graph/rebuild", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "GET", path: "/api/graph/layout", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "PUT", path: "/api/graph/layout", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "GET", path: "/api/refs", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "GET", path: "/api/page", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "GET", path: "/api/commands", kind: "legacy", safety: "read-only", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 207 } },
	{ method: "GET", path: "/api/config", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/config", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "GET", path: "/api/models", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/system/choose-directory", kind: "legacy", safety: "state-changing", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 206 } },
	{ method: "GET", path: "/api/artifacts", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "GET", path: "/api/artifacts/:id", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "GET", path: "/api/auth/status", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/auth/set", kind: "legacy", safety: "state-changing", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 205 } },
	{ method: "POST", path: "/api/auth/test", kind: "legacy", safety: "state-changing", source: "startup", temporaryLegacyException: { finding: "FIND-001", issue: 205 } },
	{ method: "GET", path: "/api/conversations", kind: "migrated-json", safety: "read-only", source: "createApp" },
	{ method: "POST", path: "/api/conversations", kind: "migrated-json", safety: "state-changing", source: "createApp" },
	{ method: "POST", path: "/api/conversations/new", kind: "migrated-json", safety: "state-changing", source: "createApp" },
] as const satisfies readonly RuntimeEndpointDeclaration[];

export function collectMountedEndpoints(
	options: CollectMountedEndpointsOptions,
): readonly MountedEndpoint[] {
	const assembledKeys = new Set(
		options.assembledRoutes
		.filter((route) => isApiEndpoint(route.method, route.path))
		.map(endpointKey),
	);
	return options.runtimeRoutes
		.filter((route) => isApiEndpoint(route.method, route.path))
		.map((route) => ({
			method: route.method.toUpperCase(),
			path: route.path,
			source: assembledKeys.has(endpointKey(route))
				? "createApp" as const
				: "startup" as const,
		}));
}

export function assertRouteRegistryParity(
	options: AssertRouteRegistryParityOptions,
): void {
	const errors: string[] = [];
	const mounted = indexUnique(options.mounted, "mounted", errors);
	const declared = indexUnique(options.declared, "declared", errors);
	const registry = indexUnique(options.registry, "registry", errors);

	for (const [key, entry] of mounted) {
		const declaration = declared.get(key);
		if (!declaration) {
			errors.push(`mounted only: ${key}`);
		} else if (entry.source !== declaration.source) {
			errors.push(`mount source mismatch: ${key} (${entry.source} != ${declaration.source})`);
		}
	}
	for (const key of declared.keys()) {
		if (!mounted.has(key)) errors.push(`method or mount mismatch: ${key}`);
	}

	for (const [key, declaration] of declared) {
		const registered = registry.get(key);
		if (!registered) {
			errors.push(`declared only: ${key}`);
			continue;
		}
		if (declaration.kind !== registered.kind) {
			errors.push(`kind mismatch: ${key} (${declaration.kind} != ${registered.kind})`);
		}
		if (declaration.safety !== registered.safety) {
			errors.push(`safety mismatch: ${key} (${declaration.safety} != ${registered.safety})`);
		}
	}
	for (const key of registry.keys()) {
		if (!declared.has(key)) errors.push(`registry only: ${key}`);
	}

	const legacy = options.declared.filter((entry) => entry.kind === "legacy");
	for (const entry of options.declared) {
		const exception = entry.temporaryLegacyException;
		if (entry.kind !== "legacy" && exception) {
			errors.push(`legacy exception metadata on non-legacy endpoint: ${endpointKey(entry)}`);
		}
		if (entry.kind !== "legacy") continue;
		if (!exception) {
			errors.push(`legacy exception metadata missing: ${endpointKey(entry)}`);
			continue;
		}
		if (!/^FIND-\d{3}$/.test(exception.finding)) {
			errors.push(`invalid legacy finding: ${endpointKey(entry)} (${exception.finding})`);
		}
		if (!LEGACY_EXCEPTION_ISSUES.has(exception.issue)) {
			errors.push(`invalid legacy issue: ${endpointKey(entry)} (#${exception.issue})`);
		}
	}
	if (legacy.length > MAX_TEMPORARY_LEGACY_EXCEPTIONS) {
		errors.push(`legacy exception count increased: ${legacy.length} > ${MAX_TEMPORARY_LEGACY_EXCEPTIONS}`);
	}

	for (const entry of options.declared) {
		const approval = entry.approvedAuxiliary;
		if (entry.source !== "startup") {
			if (approval) errors.push(`auxiliary approval on createApp endpoint: ${endpointKey(entry)}`);
			continue;
		}
		if (entry.kind === "legacy") continue;
		if (!approval) {
			errors.push(`auxiliary approval metadata missing: ${endpointKey(entry)}`);
			continue;
		}
		if (!/^AUX-\d{3}$/.test(approval.id)) {
			errors.push(`invalid auxiliary id: ${endpointKey(entry)} (${approval.id})`);
		}
		if (!/^https:\/\/github\.com\/sdyckjq-lab\/llm-wiki-skill\/(issues|pull)\/\d+/.test(approval.approval)) {
			errors.push(`invalid auxiliary approval record: ${endpointKey(entry)}`);
		}
		if (approval.boundaryCheck.trim() === "") {
			errors.push(`auxiliary boundary check missing: ${endpointKey(entry)}`);
		}
	}

	if (errors.length > 0) {
		throw new Error(`Route registry parity failed:\n- ${errors.join("\n- ")}`);
	}
}

function isApiEndpoint(method: string, path: string): boolean {
	return HTTP_METHODS.has(method.toUpperCase()) && path.startsWith("/api/");
}

function endpointKey(entry: { readonly method: string; readonly path: string }): string {
	return `${entry.method.toUpperCase()} ${entry.path}`;
}

function indexUnique<T extends { readonly method: string; readonly path: string }>(
	entries: readonly T[],
	label: string,
	errors: string[],
): Map<string, T> {
	const index = new Map<string, T>();
	for (const entry of entries) {
		const key = endpointKey(entry);
		if (index.has(key)) errors.push(`duplicate ${label}: ${key}`);
		else index.set(key, entry);
	}
	return index;
}
