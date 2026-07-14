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
