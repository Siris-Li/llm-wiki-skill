import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITY_TOKEN_HEADER } from "@llm-wiki/workbench-contracts";

import { createRuntimeApplication } from "../src/runtime-app.js";

const TOKEN = "runtime-app-test-token";
const TRUSTED_ORIGIN = "http://127.0.0.1:5180";

test("runtime application accepts a directory picker only through direct construction", async () => {
	let calls = 0;
	const app = createRuntimeApplication(TOKEN, {
		chooseDirectory: async () => {
			calls++;
			return "/fictional/browser-kb";
		},
	});

	const response = await app.request("/api/system/choose-directory", {
		method: "POST",
		headers: {
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
			origin: TRUSTED_ORIGIN,
			"sec-fetch-site": "same-origin",
		},
	});

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		ok: true,
		path: "/fictional/browser-kb",
	});
	assert.equal(calls, 1);
});

test("directly injected directory picker preserves cancellation", async () => {
	const app = createRuntimeApplication(TOKEN, {
		chooseDirectory: async () => null,
	});
	const response = await app.request("/api/system/choose-directory", {
		method: "POST",
		headers: {
			[CAPABILITY_TOKEN_HEADER]: TOKEN,
			origin: TRUSTED_ORIGIN,
			"sec-fetch-site": "same-origin",
		},
	});

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: false, canceled: true });
});
