import {
	CommandListDataSchema,
	type CommandItem,
} from "@llm-wiki/workbench-contracts";

import { request } from "./client";

export function listCommands(includeUserGlobal = false): Promise<CommandItem[]> {
	return request(
		{ method: "GET", path: "/api/commands" },
		{
			responseSchema: CommandListDataSchema,
			query: { includeUserGlobal: includeUserGlobal ? "true" : undefined },
		},
	);
}
