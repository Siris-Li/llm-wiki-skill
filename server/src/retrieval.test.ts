import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	buildKnowledgeContextPrompt,
	parseExplicitPageRefs,
	searchKnowledgeBase,
	shouldUseKnowledgeBase,
} from "./retrieval.js";

test("parseExplicitPageRefs extracts wiki markdown links in order", () => {
	assert.deepEqual(parseExplicitPageRefs("这是什么 [[wiki/synthesis/sessions/x.md]]"), [
		"wiki/synthesis/sessions/x.md",
	]);
	assert.deepEqual(parseExplicitPageRefs("[[wiki/a.md]] 和 [[wiki/b.md]]"), [
		"wiki/a.md",
		"wiki/b.md",
	]);
	assert.deepEqual(parseExplicitPageRefs("[[wiki/a.md]] [[wiki/a.md]]"), ["wiki/a.md"]);
	assert.deepEqual(parseExplicitPageRefs("[[notwiki.md]] 普通文本"), []);
});

test("shouldUseKnowledgeBase follows blacklist strategy", () => {
	assert.equal(shouldUseKnowledgeBase("总结一下", false), false);
	assert.equal(shouldUseKnowledgeBase("/sediment", true), false);
	assert.equal(shouldUseKnowledgeBase("你好。", true), false);
	assert.equal(shouldUseKnowledgeBase("当前模型是什么", true), false);
	assert.equal(shouldUseKnowledgeBase("[[wiki/x.md]] 说了啥", true), true);
	assert.equal(shouldUseKnowledgeBase("这是我自媒体创作的文章，总结一下", true), true);
	assert.equal(shouldUseKnowledgeBase("OpenClaw 相关页面讲了什么", true), true);
	assert.equal(shouldUseKnowledgeBase("嗯", true), false);
});

test("searchKnowledgeBase finds recent synthesis pages for generic summaries", async () => {
	const kbPath = await createTestKb();
	const search = await searchKnowledgeBase(kbPath, "这些文章总结一下", {
		assertRegistered: false,
		totalBudgetChars: 2000,
	});
	assert.equal(search.missingExplicitRefs.length, 0);
	assert.ok(search.results.length >= 2);
	assert.ok(search.results.some((item) => item.path.includes("wiki/synthesis/sessions")));
	assert.ok(search.results.every((item) => item.snippet.length <= 600));
});

test("searchKnowledgeBase keeps explicit refs first", async () => {
	const kbPath = await createTestKb();
	const search = await searchKnowledgeBase(kbPath, "对比一下 [[wiki/synthesis/sessions/kiro.md]]", {
		assertRegistered: false,
		explicitRefs: ["wiki/synthesis/sessions/kiro.md"],
		totalBudgetChars: 500,
	});
	assert.equal(search.results[0]?.path, "wiki/synthesis/sessions/kiro.md");
	assert.equal(search.results[0]?.hitReason, "explicit");
});

test("buildKnowledgeContextPrompt wraps empty results explicitly", () => {
	const wrapped = buildKnowledgeContextPrompt({
		originalMessage: "总结一下",
		kb: { name: "测试库", path: "/tmp/test-kb" },
		search: { results: [], missingExplicitRefs: [], totalSnippetChars: 0 },
	});
	assert.match(wrapped, /未在当前知识库找到/);
	assert.match(wrapped, /禁止反问用户提供文章/);
});

async function createTestKb(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-retrieval-"));
	await mkdir(path.join(root, "wiki", "synthesis", "sessions"), { recursive: true });
	await writeFile(path.join(root, ".wiki-schema.md"), "# schema\n", "utf8");
	await writeFile(path.join(root, "purpose.md"), "# 研究方向\n自媒体文章创作方法论\n", "utf8");
	await writeFile(path.join(root, "index.md"), "# 首页\n这是文章创作知识库。\n", "utf8");
	await writeFile(path.join(root, "wiki", "overview.md"), "# 总览\n收集 AI 创作文章。\n", "utf8");
	await writeFile(
		path.join(root, "wiki", "synthesis", "sessions", "kiro.md"),
		"# Kiro 写作方法\nKiro 文章讨论提示词、AI 编程和内容创作。\n",
		"utf8",
	);
	await writeFile(
		path.join(root, "wiki", "synthesis", "sessions", "openclaw.md"),
		"# OpenClaw 自媒体文章\nOpenClaw 文章讨论多 agent 团队和一人公司。\n",
		"utf8",
	);
	return root;
}
