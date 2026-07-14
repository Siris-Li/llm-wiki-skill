import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";

import { NewWikiDialog } from "../src/components/NewWikiDialog";
import { changeText, click, render, screen, waitFor } from "./render";

describe("NewWikiDialog", () => {
	it("submits trimmed values, resets fields, and asks the parent to close", async () => {
		const submitted: Array<{ name: string; purpose: string }> = [];
		const { openChanges } = renderDialog(async (name, purpose) => {
			submitted.push({ name, purpose });
		});

		await changeText(screen.getByPlaceholderText("stage2-research"), "  research-notes  ");
		await changeText(screen.getByPlaceholderText("研究方向"), "  local research  ");
		await click(screen.getByRole("button", { name: "创建" }));

		await waitFor(() => {
			assert.deepEqual(submitted, [{ name: "research-notes", purpose: "local research" }]);
			assert.deepEqual(openChanges, [false]);
			assert.equal((screen.getByPlaceholderText("stage2-research") as HTMLInputElement).value, "");
			assert.equal((screen.getByPlaceholderText("研究方向") as HTMLInputElement).value, "");
		});
	});

	it("cancelling clears entered values without submitting", async () => {
		const submitted: Array<{ name: string; purpose: string }> = [];
		const { openChanges } = renderDialog(async (name, purpose) => {
			submitted.push({ name, purpose });
		});

		await changeText(screen.getByPlaceholderText("stage2-research"), "discarded-name");
		await changeText(screen.getByPlaceholderText("研究方向"), "discarded-purpose");
		await click(screen.getByRole("button", { name: "取消" }));

		assert.equal((screen.getByPlaceholderText("stage2-research") as HTMLInputElement).value, "");
		assert.equal((screen.getByPlaceholderText("研究方向") as HTMLInputElement).value, "");
		assert.deepEqual(submitted, []);
		assert.deepEqual(openChanges, [false]);
	});

	it("shows validation feedback and does not submit incomplete input", async () => {
		let submissions = 0;
		renderDialog(async () => {
			submissions += 1;
		});

		await click(screen.getByRole("button", { name: "创建" }));

		assert.ok(await screen.findByText("名称和研究方向都需要填写"));
		assert.equal(submissions, 0);
	});

	it("keeps the dialog open and displays a creation failure", async () => {
		renderDialog(async () => {
			throw new Error("创建失败，请检查名称后重试");
		});

		await changeText(screen.getByPlaceholderText("stage2-research"), "failed-research");
		await changeText(screen.getByPlaceholderText("研究方向"), "failure coverage");
		await click(screen.getByRole("button", { name: "创建" }));

		assert.ok(await screen.findByText("创建失败，请检查名称后重试"));
		assert.ok(screen.getByRole("dialog"));
		assert.equal((screen.getByPlaceholderText("stage2-research") as HTMLInputElement).value, "failed-research");
	});
});

function renderDialog(onSubmit: (name: string, purpose: string) => Promise<void>) {
	const openChanges: boolean[] = [];
	render(
		<NewWikiDialog
			open
			onOpenChange={(open) => openChanges.push(open)}
			onSubmit={onSubmit}
		/>,
	);
	return { openChanges };
}
