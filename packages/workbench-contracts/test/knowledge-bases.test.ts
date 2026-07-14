import assert from "node:assert/strict";
import test from "node:test";

import {
	ActiveKnowledgeBaseDataSchema,
	ChooseDirectoryDataSchema,
	CreateKnowledgeBaseBodySchema,
	CreateKnowledgeBaseDataSchema,
	InitExistingKnowledgeBaseBodySchema,
	InitExistingKnowledgeBaseDataSchema,
	InspectKnowledgeBasePathDataSchema,
	KnowledgeBaseContextBodySchema,
	KnowledgeBaseInfoSchema,
	KnowledgeBaseListDataSchema,
	KnowledgeBasePathBodySchema,
	RegisterExternalKnowledgeBaseDataSchema,
	UnregisterExternalKnowledgeBaseDataSchema,
} from "../src/index.js";

const knowledgeBase = {
	path: "/kb/registered",
	name: "registered",
	origin: "external" as const,
	valid: true,
};

const active = {
	kb: { path: knowledgeBase.path, name: knowledgeBase.name },
	conversation: {
		id: "conversation-1",
		isNew: false,
		messages: [
			{
				id: "u-0",
				role: "user" as const,
				content: "你好",
				tools: [],
			},
		],
	},
	model: { provider: "anthropic", id: "claude-sonnet" },
};

test("知识库契约校验列表、登记、检查与 active context 的公开 data", () => {
	assert.deepEqual(KnowledgeBaseInfoSchema.parse(knowledgeBase), knowledgeBase);
	assert.deepEqual(KnowledgeBaseListDataSchema.parse([knowledgeBase]), [knowledgeBase]);
	assert.deepEqual(
		RegisterExternalKnowledgeBaseDataSchema.parse({
			registered: true,
			path: knowledgeBase.path,
			info: knowledgeBase,
		}),
		{ registered: true, path: knowledgeBase.path, info: knowledgeBase },
	);
	assert.deepEqual(
		UnregisterExternalKnowledgeBaseDataSchema.parse({
			removed: true,
			path: knowledgeBase.path,
		}),
		{ removed: true, path: knowledgeBase.path },
	);
	assert.equal(
		InspectKnowledgeBasePathDataSchema.safeParse({
			exists: true,
			isDirectory: true,
			hasWikiSchema: true,
			resolvedPath: knowledgeBase.path,
			ingestibleFiles: {
				scanId: "scan-1",
				count: 1,
				samples: ["raw/note.md"],
				paths: [`${knowledgeBase.path}/raw/note.md`],
				truncated: false,
			},
		}).success,
		true,
	);
	assert.deepEqual(ActiveKnowledgeBaseDataSchema.parse({ active }), { active });
	assert.deepEqual(ActiveKnowledgeBaseDataSchema.parse({ active: null }), {
		active: null,
	});
});

test("知识库管理 path 与上下文 kbPath 是两种明确语义，不接受旧选择字段", () => {
	assert.deepEqual(KnowledgeBasePathBodySchema.parse({ path: " /kb/candidate " }), {
		path: "/kb/candidate",
	});
	assert.deepEqual(
		KnowledgeBaseContextBodySchema.parse({ kbPath: " /kb/registered " }),
		{ kbPath: "/kb/registered" },
	);
	assert.equal(
		KnowledgeBaseContextBodySchema.safeParse({ path: "/kb/registered" }).success,
		false,
	);
	assert.equal(
		KnowledgeBaseContextBodySchema.safeParse({
			kbPath: "/kb/registered",
			path: "/kb/legacy",
		}).success,
		false,
	);
});

test("创建、初始化和目录选择使用严格的知识库领域契约", () => {
	assert.deepEqual(
		CreateKnowledgeBaseBodySchema.parse({ name: " research ", purpose: " " }),
		{ name: " research ", purpose: " " },
	);
	assert.equal(
		CreateKnowledgeBaseBodySchema.safeParse({
			name: "research",
			purpose: "topic",
			extra: true,
		}).success,
		false,
	);
	assert.deepEqual(
		InitExistingKnowledgeBaseBodySchema.parse({
			path: " /kb/candidate ",
			purpose: " topic ",
			overwrite: true,
		}),
		{ path: "/kb/candidate", purpose: " topic ", overwrite: true },
	);
	assert.equal(
		InitExistingKnowledgeBaseBodySchema.safeParse({
			path: "/kb/candidate",
			purpose: "topic",
			overwrite: "yes",
		}).success,
		false,
	);
	assert.deepEqual(CreateKnowledgeBaseDataSchema.parse({ info: knowledgeBase }), {
		info: knowledgeBase,
	});
	assert.deepEqual(InitExistingKnowledgeBaseDataSchema.parse({ info: knowledgeBase }), {
		info: knowledgeBase,
	});
	assert.deepEqual(ChooseDirectoryDataSchema.parse({ path: null }), { path: null });
	assert.deepEqual(ChooseDirectoryDataSchema.parse({ path: "/kb/chosen" }), {
		path: "/kb/chosen",
	});
});
