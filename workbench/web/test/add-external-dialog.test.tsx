import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";

import { AddExternalDialog } from "../src/components/AddExternalDialog";
import { changeText, click, render, screen, waitFor } from "./render";

const initializedKnowledgeBase = {
	path: "/kb/candidate",
	name: "candidate",
	origin: "external" as const,
	valid: true,
};

describe("AddExternalDialog", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("directory picker cancellation keeps the current path and does not show an error", async () => {
		const requests = stubFetch(async (url) => {
			if (url === "/api/models") return json({ ok: true, data: [] });
			if (url === "/api/config") {
				return json({ ok: true, data: { version: 1, externalKnowledgeBases: [] } });
			}
			if (url === "/api/system/choose-directory") {
				return json({ ok: true, data: { path: null } });
			}
			return json({ ok: false, code: "NOT_FOUND", message: `Unexpected ${url}` }, 404);
		});

		render(<AddExternalDialog open onOpenChange={() => {}} onSubmit={async () => {}} />);
		const pathInput = screen.getByPlaceholderText("~/Documents/我的知识库") as HTMLInputElement;
		await changeText(pathInput, "/kb/kept-after-cancel");
		await click(screen.getByRole("button", { name: "选择文件夹" }));

		await waitFor(() => {
			assert.equal(pathInput.value, "/kb/kept-after-cancel");
		});
		assert.equal(requests.includes("POST /api/system/choose-directory"), true);
		assert.equal(Boolean(screen.queryByText("服务器内部错误")), false);
	});

	it("initialization conflict keeps the recovery action and retries with overwrite", async () => {
		let initAttempts = 0;
		const initBodies: unknown[] = [];
		const requests = stubFetch(async (url, init) => {
			if (url === "/api/models") return json({ ok: true, data: [] });
			if (url === "/api/config") {
				return json({ ok: true, data: { version: 1, externalKnowledgeBases: [] } });
			}
			if (url === "/api/knowledge-bases/inspect") {
				return json({
					ok: true,
					data: {
						exists: true,
						isDirectory: true,
						hasWikiSchema: false,
						resolvedPath: "/kb/candidate",
						ingestibleFiles: {
							scanId: "scan-1",
							count: 0,
							samples: [],
							paths: [],
							truncated: false,
						},
					},
				});
			}
			if (url === "/api/knowledge-bases/init-existing") {
				initAttempts += 1;
				initBodies.push(JSON.parse(String(init?.body)));
				if (initAttempts === 1) {
					return json(
						{
							ok: false,
							code: "CONFLICT",
							message: "目标目录存在需要确认的文件",
							details: { conflicts: ["index.md"] },
						},
						409,
					);
				}
				return json({ ok: true, data: { info: initializedKnowledgeBase } });
			}
			return json({ ok: false, code: "NOT_FOUND", message: `Unexpected ${url}` }, 404);
		});
		const submitted: string[] = [];

		render(
			<AddExternalDialog
				open
				onOpenChange={() => {}}
				onSubmit={async (path) => {
					submitted.push(path);
				}}
			/>,
		);
		await changeText(screen.getByPlaceholderText("~/Documents/我的知识库"), "/kb/candidate");
		const purposeInput = await screen.findByPlaceholderText("这个知识库研究什么？");
		await changeText(purposeInput, "topic");
		await click(screen.getByRole("button", { name: "初始化并添加" }));
		const recover = await screen.findByRole("button", { name: "备份并继续" });
		await click(recover);

		await waitFor(() => {
			assert.deepEqual(submitted, [initializedKnowledgeBase.path]);
		});
		assert.deepEqual(initBodies, [
			{ path: "/kb/candidate", purpose: "topic", overwrite: false },
			{ path: "/kb/candidate", purpose: "topic", overwrite: true },
		]);
		assert.equal(requests.filter((request) => request === "POST /api/knowledge-bases/init-existing").length, 2);
	});
});

function stubFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response>,
): string[] {
	const requests: string[] = [];
	globalThis.fetch = ((input: URL | string, init?: RequestInit) => {
		const url = String(input);
		requests.push(`${init?.method ?? "GET"} ${url}`);
		return handler(url, init);
	}) as typeof globalThis.fetch;
	return requests;
}

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
