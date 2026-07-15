import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { listCommands } from "../src/lib/api/commands";

describe("commands API module", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("distinguishes saved preference from explicit true and false overrides", async () => {
		const requests: string[] = [];
		globalThis.fetch = (async (input) => {
			requests.push(String(input));
			return new Response(JSON.stringify({ ok: true, data: [] }), {
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof globalThis.fetch;

		await listCommands();
		await listCommands(true);
		await listCommands(false);

		assert.deepEqual(requests, [
			"/api/commands",
			"/api/commands?includeUserGlobal=true",
			"/api/commands?includeUserGlobal=false",
		]);
	});
});
