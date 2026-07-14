import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	initExistingWiki,
	initScriptCandidates,
	KnowledgeBaseSetupInputError,
	validateWikiName,
} from "./wiki-init.js";

test("initScriptCandidates supports Codex and Claude skill install locations", () => {
	const home = path.join("/", "Users", "example");
	assert.deepEqual(initScriptCandidates(home), [
		path.join(home, ".codex", "skills", "llm-wiki", "init-wiki.sh"),
		path.join(home, ".codex", "skills", "llm-wiki", "scripts", "init-wiki.sh"),
		path.join(home, ".codex", "skills", "llm-wiki-skill", "init-wiki.sh"),
		path.join(home, ".codex", "skills", "llm-wiki-skill", "scripts", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki-skill", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki-skill", "scripts", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki", "scripts", "init-wiki.sh"),
	]);
});

test("创建和初始化的可恢复输入错误带稳定标记，且不回显目标路径", async () => {
	assert.throws(
		() => validateWikiName("../escape"),
		(err) => err instanceof KnowledgeBaseSetupInputError,
	);

	const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-init-input-"));
	const missing = path.join(root, "missing");
	try {
		await assert.rejects(
			() => initExistingWiki(missing, "topic"),
			(err) =>
				err instanceof KnowledgeBaseSetupInputError &&
				err.message === "请选择一个存在的文件夹" &&
				!err.message.includes(missing),
		);

		const emptyPurpose = path.join(root, "empty-purpose");
		await mkdir(emptyPurpose);
		await assert.rejects(
			() => initExistingWiki(emptyPurpose, " "),
			(err) =>
				err instanceof KnowledgeBaseSetupInputError &&
				err.message === "研究方向不能为空",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
