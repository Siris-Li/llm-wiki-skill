import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { act } from "@testing-library/react";
import { createGraphEngine } from "@llm-wiki/graph-engine";

import { GraphPanel } from "../src/components/GraphPanel";
import { click, pressKey, render, screen, waitFor } from "./render";

describe("GraphPanel Paper shell", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("renders the graph shell toolbar without adding app-level graph overlays", async () => {
		mockGraphFetch();

		render(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
			/>,
		);

		const toolbar = screen.getByRole("banner", { name: "图谱工具栏" });
		assert.equal(toolbar.classList.contains("graph-shell-toolbar"), true);
		assert.match(toolbar.textContent ?? "", /图谱活地图/);
		assert.ok(screen.getByRole("button", { name: /重置布局/ }));
		assert.ok(screen.getByRole("button", { name: /增强显示/ }));
		assert.ok(screen.getByRole("button", { name: /重构/ }));
		assert.notEqual(toolbar.querySelector(".graph-shell-legend"), null);

		await waitFor(() => {
			assert.match(toolbar.textContent ?? "", /1 节点 · 0 关联/);
		});

		const shell = document.querySelector(".graph-shell");
		const stage = document.querySelector(".graph-stage");
		assert.ok(shell);
		assert.ok(stage);
		assert.equal(shell?.contains(toolbar), true);
		assert.equal(shell?.contains(stage), true);
		assert.equal(stage?.contains(toolbar), false);
		assert.notEqual(screen.queryByLabelText("图谱图例"), null);
		assert.equal(document.querySelector(".graph-legend"), null);
		assert.ok(document.querySelector(".graph-host"));
	});

	it("opens graph edge tuning controls from the toolbar", async () => {
		mockGraphFetch();

		render(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
			/>,
		);

		const tuningButton = screen.getByRole("button", { name: /增强显示/ }) as HTMLButtonElement;
		await waitFor(() => {
			assert.equal(tuningButton.disabled, false);
		});
		await click(tuningButton);

		const panel = screen.getByRole("dialog", { name: "图谱增强显示" });
		assert.match(panel.textContent ?? "", /默认已分清主次/);
		assert.match(panel.textContent ?? "", /突出对比和矛盾/);
		assert.match(panel.textContent ?? "", /点亮当前范围/);
		const semanticToggle = screen.getByRole("checkbox", { name: /语义强调/ });
		const focusToggle = screen.getByRole("checkbox", { name: /聚焦点亮/ });
		assert.equal((semanticToggle as HTMLInputElement).checked, false);
		assert.equal((focusToggle as HTMLInputElement).checked, false);
		assert.equal(document.activeElement, semanticToggle);

		await click(semanticToggle);

		await waitFor(() => {
			assert.equal((semanticToggle as HTMLInputElement).checked, true);
			assert.equal(localStorage.getItem("llm-wiki.graph.edge-style"), "{\"semanticEmphasis\":true,\"focusHighlight\":false}");
		});

		await click(focusToggle);

		await waitFor(() => {
			assert.equal((focusToggle as HTMLInputElement).checked, true);
			assert.equal(localStorage.getItem("llm-wiki.graph.edge-style"), "{\"semanticEmphasis\":true,\"focusHighlight\":true}");
		});

		await pressKey(document, "Escape");

		assert.equal(screen.queryByRole("dialog", { name: "图谱增强显示" }), null);
		assert.equal(document.activeElement, tuningButton);
	});

	it("keeps edge tuning changes local to community reading and clears them on return", async () => {
		mockGraphFetch();
		const selectionChanges: unknown[] = [];
		const { rerender } = render(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
				onSelectionChange={(selection) => selectionChanges.push(selection)}
			/>,
		);

		await waitFor(() => {
			assert.match(document.body.textContent ?? "", /1 节点 · 0 关联/);
		});

		rerender(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
				onSelectionChange={(selection) => selectionChanges.push(selection)}
				selectionCommand={{ id: "paper", type: "enter-community" }}
			/>,
		);

		await waitFor(() => {
			assert.deepEqual(selectionChanges, [null]);
			assert.notEqual(screen.queryByRole("button", { name: "回全图" }), null);
		});

		const tuningButton = screen.getByRole("button", { name: /增强显示/ }) as HTMLButtonElement;
		await click(tuningButton);
		const semanticToggle = screen.getByRole("checkbox", { name: /语义强调/ }) as HTMLInputElement;
		await click(semanticToggle);

		await waitFor(() => {
			assert.equal(semanticToggle.checked, true);
			assert.equal(localStorage.getItem("llm-wiki.graph.edge-style"), null);
		});

		await click(screen.getByRole("button", { name: "回全图" }));

		await waitFor(() => {
			assert.equal(localStorage.getItem("llm-wiki.graph.edge-style"), null);
		});
		await click(tuningButton);
		const returnedSemanticToggle = screen.getByRole("checkbox", { name: /语义强调/ }) as HTMLInputElement;
		assert.equal(returnedSemanticToggle.checked, false);
	});

	it("surfaces graph build errors in the graph panel", async () => {
		mockGraphFetch({ needsBuild: true });

		const { rerender } = render(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
			/>,
		);

		await waitFor(() => {
			assert.match(screen.getByText("图谱构建中").textContent ?? "", /图谱构建中/);
		});

		rerender(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
				graphBuildError={{ kbPath: "/kb", message: "构建失败", rebuiltAt: "2026-06-20T00:00:00.000Z" }}
			/>,
		);

		await waitFor(() => {
			assert.match(screen.getByText("图谱暂时不可用").textContent ?? "", /图谱暂时不可用/);
			assert.match(document.body.textContent ?? "", /构建失败/);
		});
	});

	it("does not let an older graph read overwrite a newer build error", async () => {
		let resolveGraph!: (response: Response) => void;
		const graphResponse = new Promise<Response>((resolve) => {
			resolveGraph = resolve;
		});
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.startsWith("/api/graph/layout")) {
				return jsonResponse({
					ok: true,
					data: { version: 2, pins: {}, updatedAt: "2026-07-15T12:00:00.000Z" },
				});
			}
			if (url.startsWith("/api/graph?")) return graphResponse;
			return jsonResponse({ ok: false, code: "UNEXPECTED", message: "Unexpected fictional request" }, 500);
		}) as typeof fetch;

		const { rerender } = render(
			<GraphPanel
				currentKnowledgeBaseName="Fictional notes"
				currentKnowledgeBasePath="/fictional/kb"
				theme="light"
			/>,
		);
		rerender(
			<GraphPanel
				currentKnowledgeBaseName="Fictional notes"
				currentKnowledgeBasePath="/fictional/kb"
				theme="light"
				graphBuildError={{
					kbPath: "/fictional/kb",
					message: "图谱重建失败",
					rebuiltAt: "2026-07-15T12:01:00.000Z",
				}}
			/>,
		);
		await screen.getByText("图谱暂时不可用");

		await act(async () => {
			resolveGraph(jsonResponse({
				ok: true,
				data: readyGraphResult(),
			}));
			await graphResponse;
		});

		assert.notEqual(screen.queryByText("图谱暂时不可用"), null);
		assert.equal(screen.queryByText("1 节点 · 0 关联"), null);
	});

	it("applies one authoritative snapshot and discards an older queued graph update", async () => {
		let graphReads = 0;
		let resolveOlderGraph!: (response: Response) => void;
		const olderGraphResponse = new Promise<Response>((resolve) => {
			resolveOlderGraph = resolve;
		});
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.startsWith("/api/graph/layout")) {
				return jsonResponse({
					ok: true,
					data: { version: 2, pins: {}, updatedAt: "2026-07-15T12:00:00.000Z" },
				});
			}
			if (url.startsWith("/api/graph?")) {
				graphReads += 1;
				if (graphReads === 1) return jsonResponse({ ok: true, data: readyGraphResult() });
				if (graphReads === 2) return olderGraphResponse;
			}
			return jsonResponse({ ok: false, code: "UNEXPECTED", message: "Unexpected fictional request" }, 500);
		}) as typeof fetch;

		const props = {
			currentKnowledgeBaseName: "Fictional notes",
			currentKnowledgeBasePath: "/fictional/kb",
			theme: "light" as const,
		};
		const staleDiff = {
			addedNodes: ["wiki/stale.md"],
			removedNodes: [],
			recoloredNodes: [],
			addedEdges: [],
			removedEdges: [],
			newCommunities: [],
			stats: { nodeCount: 2, edgeCount: 0, communityCount: 0 },
		};
		const { rerender } = render(<GraphPanel {...props} refreshToken={0} />);
		await screen.findByText("1 节点 · 0 关联");

		rerender(<GraphPanel {...props} refreshToken={1} pendingDiff={staleDiff} />);
		await waitFor(() => {
			assert.equal(document.querySelector("[data-graph-animation='queued']") !== null, true);
			assert.equal(graphReads, 2);
		});

		rerender(
			<GraphPanel
				{...props}
				refreshToken={1}
				authoritativeSnapshot={{
					kbPath: "/fictional/kb",
					result: readyGraphResult(["wiki/current.md", "wiki/current-detail.md"]),
				}}
			/>,
		);
		await screen.findByText("2 节点 · 0 关联");
		assert.notEqual(document.querySelector("[data-graph-animation='idle']"), null);
		assert.equal(graphReads, 2, "the panel must not repeat the authoritative graph read");

		await act(async () => {
			resolveOlderGraph(jsonResponse({ ok: true, data: readyGraphResult() }));
			await olderGraphResponse;
		});
		assert.notEqual(screen.queryByText("2 节点 · 0 关联"), null);
		assert.equal(screen.queryByText("图谱更新待播放"), null);
	});

	it("does not let an older playing animation finish the current authoritative animation", async () => {
		let graphResult = readyGraphResult();
		const animationResolvers: Array<() => void> = [];
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.startsWith("/api/graph/layout")) {
				return jsonResponse({
					ok: true,
					data: { version: 2, pins: {}, updatedAt: "2026-07-15T12:00:00.000Z" },
				});
			}
			if (url.startsWith("/api/graph?")) return jsonResponse({ ok: true, data: graphResult });
			return jsonResponse({ ok: false, code: "UNEXPECTED", message: "Unexpected fictional request" }, 500);
		}) as typeof fetch;
		const engineFactory: typeof createGraphEngine = (container, options) => ({
			...createGraphEngine(container, options),
			applyDiff: () => new Promise<void>((resolve) => animationResolvers.push(resolve)),
		});
		const props = {
			currentKnowledgeBaseName: "Fictional notes",
			currentKnowledgeBasePath: "/fictional/kb",
			theme: "light" as const,
			engineFactory,
		};
		const firstDiff = graphDiff("wiki/first-update.md", 2);
		const currentDiff = graphDiff("wiki/current-update.md", 3);
		const { rerender } = render(<GraphPanel {...props} refreshToken={0} />);
		await screen.findByText("1 节点 · 0 关联");

		graphResult = readyGraphResult(["wiki/fictional.md", "wiki/first-update.md"]);
		rerender(<GraphPanel {...props} refreshToken={1} pendingDiff={firstDiff} />);
		await waitFor(() => {
			assert.notEqual(document.querySelector("[data-graph-animation='playing']"), null);
			assert.equal(animationResolvers.length, 1);
		});

		const currentResult = readyGraphResult([
			"wiki/fictional.md",
			"wiki/first-update.md",
			"wiki/current-update.md",
		]);
		graphResult = currentResult;
		rerender(
			<GraphPanel
				{...props}
				refreshToken={1}
				authoritativeSnapshot={{ kbPath: "/fictional/kb", result: currentResult }}
			/>,
		);
		await screen.findByText("3 节点 · 0 关联");
		rerender(<GraphPanel {...props} refreshToken={2} pendingDiff={currentDiff} />);
		await waitFor(() => {
			assert.notEqual(document.querySelector("[data-graph-animation='playing']"), null);
			assert.equal(animationResolvers.length, 2);
		});

		await act(async () => {
			animationResolvers[0]!();
			await Promise.resolve();
		});
		assert.notEqual(document.querySelector("[data-graph-animation='playing']"), null);
		await act(async () => {
			animationResolvers[1]!();
			await Promise.resolve();
		});
		await waitFor(() => assert.notEqual(document.querySelector("[data-graph-animation='idle']"), null));
	});

	it("clears stale graph state after calibration failure and recovers on the next update", async () => {
		let graphResult = readyGraphResult();
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.startsWith("/api/graph/layout")) {
				return jsonResponse({
					ok: true,
					data: { version: 2, pins: {}, updatedAt: "2026-07-15T12:00:00.000Z" },
				});
			}
			if (url.startsWith("/api/graph?")) return jsonResponse({ ok: true, data: graphResult });
			return jsonResponse({ ok: false, code: "UNEXPECTED", message: "Unexpected fictional request" }, 500);
		}) as typeof fetch;

		const props = {
			currentKnowledgeBaseName: "Fictional notes",
			currentKnowledgeBasePath: "/fictional/kb",
			theme: "light" as const,
		};
		const { rerender } = render(<GraphPanel {...props} refreshToken={0} />);
		await screen.findByText("1 节点 · 0 关联");

		rerender(
			<GraphPanel
				{...props}
				refreshToken={0}
				graphBuildError={{
					kbPath: "/fictional/kb",
					message: "图谱状态校准失败，请重新连接后重试",
					rebuiltAt: "2026-07-15T12:01:00.000Z",
				}}
			/>,
		);
		await screen.findByText("图谱暂时不可用");
		assert.equal(screen.queryByText("1 节点 · 0 关联"), null);
		assert.notEqual(document.querySelector("[data-graph-animation='idle']"), null);

		graphResult = readyGraphResult(["wiki/recovered.md", "wiki/recovered-detail.md"]);
		rerender(<GraphPanel {...props} refreshToken={1} graphBuildError={null} />);
		await screen.findByText("2 节点 · 0 关联");
		assert.equal(screen.queryByText("图谱暂时不可用"), null);
	});

	it("loads a saved authoritative error and recovers after an active rebuild", async () => {
		let graphResult: unknown = {
			state: {
				status: "error",
				message: "图谱重建失败",
				rebuiltAt: "2026-07-15T12:00:00.000Z",
			},
		};
		globalThis.fetch = (async (input) => {
			const url = String(input);
			if (url.startsWith("/api/graph/layout")) {
				return jsonResponse({
					ok: true,
					data: { version: 2, pins: {}, updatedAt: "2026-07-15T12:00:00.000Z" },
				});
			}
			if (url.startsWith("/api/graph?")) {
				return jsonResponse({ ok: true, data: graphResult });
			}
			if (url.startsWith("/api/graph/rebuild")) {
				return jsonResponse({ ok: true, data: { status: "started" } });
			}
			return jsonResponse({ ok: false, code: "UNEXPECTED", message: "Unexpected fictional request" }, 500);
		}) as typeof fetch;

		const props = {
			currentKnowledgeBaseName: "Fictional notes",
			currentKnowledgeBasePath: "/fictional/kb",
			theme: "light" as const,
		};
		const { rerender } = render(<GraphPanel {...props} refreshToken={0} />);
		await screen.findByText("图谱暂时不可用");
		assert.equal((screen.getByRole("button", { name: "重构" }) as HTMLButtonElement).disabled, false);

		await click(screen.getByRole("button", { name: "重构" }));
		graphResult = readyGraphResult();
		rerender(<GraphPanel {...props} refreshToken={1} />);

		await screen.findByText("1 节点 · 0 关联");
		assert.equal(screen.queryByText("图谱暂时不可用"), null);
	});

	it("notifies the app to close the community summary drawer when entering a community", async () => {
		mockGraphFetch();
		const selectionChanges: unknown[] = [];
		const { rerender } = render(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
				onSelectionChange={(selection) => selectionChanges.push(selection)}
			/>,
		);

		await waitFor(() => {
			assert.match(document.body.textContent ?? "", /1 节点 · 0 关联/);
		});

		rerender(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
				onSelectionChange={(selection) => selectionChanges.push(selection)}
				selectionCommand={{ id: "paper", type: "enter-community" }}
			/>,
		);

		await waitFor(() => {
			assert.deepEqual(selectionChanges, [null]);
		});
	});

	it("does not clear graph interaction from the workbench shell on Escape", async () => {
		mockGraphFetch();
		const selectionChanges: unknown[] = [];
		render(
			<GraphPanel
				currentKnowledgeBaseName="AI 学习库"
				currentKnowledgeBasePath="/kb"
				theme="light"
				onSelectionChange={(selection) => selectionChanges.push(selection)}
			/>,
		);

		await waitFor(() => {
			assert.match(document.body.textContent ?? "", /1 节点 · 0 关联/);
		});

		await pressKey(document, "Escape");

		assert.deepEqual(selectionChanges, []);
	});

	it("keeps the GraphPanel Paper shell styling outside graph-engine internals", () => {
		const css = readFileSync(resolve(import.meta.dirname, "../src/index.css"), "utf8");

		assert.match(css, /\.graph-shell\s*\{[\s\S]*display:\s*grid/);
		assert.match(css, /\.graph-shell-toolbar[\s\S]*position:\s*relative/);
		assert.match(css, /\.graph-stage[\s\S]*min-height:\s*0/);
		assert.match(css, /\.graph-shell-legend[\s\S]*display:\s*flex/);
		assert.doesNotMatch(cssBlock(css, ".graph-shell-toolbar"), /position:\s*absolute/);
		assert.match(css, /\.graph-shell-toolbar[\s\S]*var\(--paper-grain\)/);
		assert.match(css, /\.graph-shell-toolbar-chip,[\s\S]*\.graph-shell-toolbar-button/);
		assert.match(css, /\.graph-stage[\s\S]*border-radius:\s*16px/);
		assert.doesNotMatch(css, /(^|\n)\s*\.graph-toolbar\b/);
		assert.doesNotMatch(css, /(^|\n)\s*\.graph-legend\b/);
		assert.doesNotMatch(css, /render-styles|sigma-node|sigma-edge/);
	});
});

function cssBlock(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`);
	if (start === -1) return "";
	const end = css.indexOf("\n  }", start);
	return end === -1 ? css.slice(start) : css.slice(start, end);
}

function mockGraphFetch(options: { needsBuild?: boolean } = {}) {
	globalThis.fetch = (async (input) => {
		const url = String(input);
		if (url.startsWith("/api/graph/layout")) {
			return jsonResponse({
				ok: true,
				data: { version: 2, pins: {}, updatedAt: "2026-06-20T00:00:00.000Z" },
			});
		}
			if (url.startsWith("/api/graph?")) {
				if (options.needsBuild) {
					return jsonResponse({
						ok: true,
						data: {
							state: { status: "ready", rebuiltAt: null },
							needsBuild: true,
						},
					});
				}
				return jsonResponse({
					ok: true,
					data: {
						state: { status: "ready", rebuiltAt: null },
						needsBuild: false,
					data: {
						meta: {
							build_date: "2026-06-20T00:00:00.000Z",
							wiki_title: "AI 学习库",
							total_nodes: 1,
							total_edges: 0,
						},
						nodes: [
							{
								id: "wiki/paper.md",
								label: "Paper",
								title: "Paper",
								type: "topic",
								community: "paper",
								path: "wiki/paper.md",
							},
						],
						edges: [],
						communities: [],
					},
				},
			});
			}
		if (url.startsWith("/api/graph/rebuild")) {
			return jsonResponse({ ok: true, data: { status: "started" } });
		}
		return jsonResponse({ ok: false, error: `Unexpected request: ${url}` }, 500);
	}) as typeof fetch;
}

function readyGraphResult(nodeIds = ["wiki/fictional.md"]) {
	return {
		state: { status: "ready", rebuiltAt: "2026-07-15T12:00:00.000Z" },
		needsBuild: false,
		data: {
			meta: {
				build_date: "2026-07-15T12:00:00.000Z",
				wiki_title: "Fictional notes",
				total_nodes: nodeIds.length,
				total_edges: 0,
			},
			nodes: nodeIds.map((id, index) => ({
				id,
				label: `Fictional ${index + 1}`,
				type: "topic",
				source_path: id,
			})),
			edges: [],
		},
	};
}

function graphDiff(nodeId: string, nodeCount: number) {
	return {
		addedNodes: [nodeId],
		removedNodes: [],
		recoloredNodes: [],
		addedEdges: [],
		removedEdges: [],
		newCommunities: [],
		stats: { nodeCount, edgeCount: 0, communityCount: 0 },
	};
}

function jsonResponse(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
