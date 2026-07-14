import type { KnowledgeBaseInfo } from "@llm-wiki/workbench-contracts";

/**
 * The endpoints in this file have not been migrated to shared contracts yet.
 * Keep their old response parsing isolated here so migrated domain clients cannot
 * accidentally grow legacy fallbacks.
 */

export interface CommandItem {
	slug: string;
	name: string;
	description: string;
	source: "builtin" | "pi-default" | "user-global";
	skillPath: string | null;
}

export async function chooseDirectory(): Promise<string | null> {
	const res = await fetch("/api/system/choose-directory", { method: "POST" });
	const json = (await res.json()) as {
		ok: boolean;
		path?: string;
		canceled?: boolean;
		error?: string;
	};
	if (json.canceled) return null;
	if (!res.ok || !json.ok || !json.path) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return json.path;
}

export async function initExistingKnowledgeBase(
	path: string,
	purpose: string,
	overwrite = false,
): Promise<{ info: KnowledgeBaseInfo; backedUpFiles: string[] }> {
	const res = await fetch("/api/knowledge-bases/init-existing", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path, purpose, overwrite }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		info?: KnowledgeBaseInfo;
		backedUpFiles?: string[];
		conflicts?: string[];
		error?: string;
	};
	if (!res.ok || !json.ok || !json.info) {
		const error = new Error(json.error ?? `HTTP ${res.status}`) as Error & {
			conflicts?: string[];
		};
		error.conflicts = json.conflicts;
		throw error;
	}
	return { info: json.info, backedUpFiles: json.backedUpFiles ?? [] };
}

export async function createKnowledgeBase(
	name: string,
	purpose: string,
): Promise<KnowledgeBaseInfo> {
	const res = await fetch("/api/knowledge-bases/new", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, purpose }),
	});
	const json = (await res.json()) as {
		ok: boolean;
		info?: KnowledgeBaseInfo;
		error?: string;
	};
	if (!res.ok || !json.ok || !json.info) {
		throw new Error(json.error ?? `HTTP ${res.status}`);
	}
	return json.info;
}

export async function listCommands(
	includeUserGlobal = false,
): Promise<CommandItem[]> {
	const suffix = includeUserGlobal ? "?includeUserGlobal=true" : "";
	const res = await fetch(`/api/commands${suffix}`);
	const json = (await res.json()) as {
		ok: boolean;
		items?: CommandItem[];
		error?: string;
	};
	if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
	return json.items ?? [];
}
