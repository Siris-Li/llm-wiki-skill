import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RightDrawer } from "../src/components/RightDrawer";
import { GraphSelection } from "../src/components/GraphSelection";
import { graphSelectionDrawer, type DrawerState } from "../src/lib/drawer-state";
import type { Selection } from "@llm-wiki/graph-engine";
import { changeText, click, render, screen } from "./render";

describe("RightDrawer graph selection group drawer", () => {
	it("renders multi-node selections through the same group drawer skeleton", () => {
		const html = renderDrawer(graphSelectionDrawer(selectionFixture(), "选区"));

		assert.match(html, /data-testid="graph-selection-drawer"/);
		assert.match(html, /选区/);
		assert.match(html, /graph-group-meta-row/);
		assert.match(html, /graph-group-meta-row[\s\S]*graph-summary-kicker[^>]*>选区<\/span>/);
		assert.match(html, /graph-group-meta-row[\s\S]*graph-group-status-chip[^>]*>Shift\+点击增删节点<\/span>/);
		assert.doesNotMatch(html, /graph-group-enter/);
		assert.match(html, /总结这一簇/);
		assert.match(html, /找知识缺口/);
		assert.match(html, /生成主题页/);
		assert.match(html, /探索潜在关系/);
		assert.match(html, /补充说明（可选）/);
		assert.match(html, /发送/);
		assert.match(html, /新对话/);
		assert.match(html, /当前选区会带入对话/);
		assert.match(html, /data-group-drawer="true"/);
		assert.doesNotMatch(html, /graph-selection-actions/);
		// 2 个节点 ≤ 3，不应出现展开入口。
		assert.doesNotMatch(html, /查看全部|收起/);
	});

	it("disables send until free text exists and enables it once typed", () => {
		const empty = renderDrawer(graphSelectionDrawer(selectionFixture(), "选区"));
		assert.match(empty, /<button[^>]*data-group-drawer="send"[^>]*disabled/);
		const filled = renderDrawer(graphSelectionDrawer(selectionFixture(), "选区", "看一下缺口"));
		assert.doesNotMatch(filled, /<button[^>]*data-group-drawer="send"[^>]*disabled/);
	});

	it("shows 查看全部 when more than three pages are selected", () => {
		// #119：选区抽屉复用社区抽屉的"查看全部 / 收起"。>3 节点时默认折叠到前 3 个，
		// 提供"查看全部"入口；折叠态下不应出现"收起"。
		const html = renderDrawer(graphSelectionDrawer(selectionFixture({
			id: "nodes:a,b,c,d",
			nodeIds: ["a", "b", "c", "d"],
			facts: { pageCount: 4, internalLinkCount: 0, communityCount: 2, isolatedCount: 0 },
			input: { kind: "nodes", ids: ["a", "b", "c", "d"] },
		}), "选区"));

		assert.match(html, /查看全部/);
		assert.doesNotMatch(html, /收起/);
	});

	it("preserves expanded state, focus and free text across shift selection updates", async () => {
		// #119：Shift 多选会持续增长选区。抽屉必须"安静实时更新"——
		// 不重挂载、不重置展开态、不抢 textarea 焦点、不清补充说明。
		const four = selectionFixture({
			id: "nodes:a,b,c,d",
			nodeIds: ["a", "b", "c", "d"],
			facts: { pageCount: 4, internalLinkCount: 0, communityCount: 2, isolatedCount: 0 },
			input: { kind: "nodes", ids: ["a", "b", "c", "d"] },
		});
		const five = selectionFixture({
			id: "nodes:a,b,c,d,e",
			nodeIds: ["a", "b", "c", "d", "e"],
			facts: { pageCount: 5, internalLinkCount: 0, communityCount: 2, isolatedCount: 0 },
			input: { kind: "nodes", ids: ["a", "b", "c", "d", "e"] },
		});

		let freeText = "";
		const onFreeTextChange = (value: string) => { freeText = value; };
		const props = (selection: Selection) => (
			<GraphSelection
				title="选区"
				selection={selection}
				freeText={freeText}
				onFreeTextChange={onFreeTextChange}
				onAsk={() => {}}
				onAskInNewConversation={() => {}}
			/>
		);

		const { rerender } = render(props(four));

		// 默认折叠：露出"查看全部"。
		assert.ok(screen.getByRole("button", { name: "查看全部" }));

		// 展开全部节点。
		await click(screen.getByRole("button", { name: "查看全部" }));
		assert.ok(screen.getByRole("button", { name: "收起" }));

		// 输入补充说明，并让 textarea 获得焦点（模拟用户正在编辑）。
		const textarea = screen.getByPlaceholderText("补充说明（可选）") as HTMLTextAreaElement;
		await changeText(textarea, "我的备注");
		assert.equal(freeText, "我的备注");
		textarea.focus();
		assert.equal(document.activeElement, textarea);

		// 模拟 Shift 加第 5 个节点：App 层 drawerForGraphSelection 会保留 freeText 重渲染。
		// 组件实例不应被重挂载——展开态、焦点、补充说明都得保留。
		rerender(props(five));

		assert.ok(screen.getByRole("button", { name: "收起" }), "展开态应保留");
		assert.equal(document.activeElement, textarea, "textarea 焦点不应被抢走");
		assert.equal(
			(screen.getByPlaceholderText("补充说明（可选）") as HTMLTextAreaElement).value,
			"我的备注",
			"补充说明不应被清空",
		);
	});
});

function renderDrawer(drawer: DrawerState): string {
	return renderToStaticMarkup(
		React.createElement(RightDrawer, {
			drawer,
			fullscreen: false,
			width: 420,
			defaultWidth: 420,
			onSelectArtifact: noopString,
			onOpenPage: noopString,
			onWikiLinkSeen: noopString,
			onGraphReaderAction: noopString,
			onGraphSummaryCommand: noopCommand,
			onGraphSummaryNodePreview: noopPreviewNode,
			onGraphSelectionTextChange: noopString,
			onGraphSelectionAsk: noopSelectionAsk,
			onGraphCommunityTextChange: noopString,
			onGraphCommunityAsk: noopSelectionAsk,
			onResize: noopNumber,
			onToggleFullscreen: noop,
			onClose: noopClose,
		}),
	);
}

function selectionFixture(overrides: Partial<Selection> = {}): Selection {
	return {
		id: "nodes:a,b",
		nodeIds: ["a", "b"],
		communityIds: ["alpha", "beta"],
		facts: { pageCount: 2, internalLinkCount: 1, communityCount: 2, isolatedCount: 0 },
		input: { kind: "nodes", ids: ["a", "b"] },
		actions: [],
		...overrides,
	};
}

function noop() {}
function noopString() {}
function noopNumber() {}
function noopCommand() {}
function noopPreviewNode() {}
function noopSelectionAsk() {}
function noopClose() {}
