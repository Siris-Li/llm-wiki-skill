import {
	ActiveKnowledgeBaseDataSchema,
	InspectKnowledgeBasePathDataSchema,
	KnowledgeBaseContextBodySchema,
	KnowledgeBaseListDataSchema,
	KnowledgeBasePathBodySchema,
	RegisterExternalKnowledgeBaseDataSchema,
	UnregisterExternalKnowledgeBaseDataSchema,
	type ActiveContext,
	type InspectKnowledgeBasePathData,
	type KnowledgeBaseInfo,
} from "@llm-wiki/workbench-contracts";

import { request } from "./client";

export type {
	ActiveContext,
	CurrentKnowledgeBase,
	InspectKnowledgeBasePathData as InspectPathResult,
	KnowledgeBaseInfo,
	UIMessage,
} from "@llm-wiki/workbench-contracts";

export function listKnowledgeBases(): Promise<KnowledgeBaseInfo[]> {
	return request("/api/knowledge-bases", {
		responseSchema: KnowledgeBaseListDataSchema,
	});
}

export async function getActiveContext(): Promise<ActiveContext | null> {
	const { active } = await request("/api/knowledge-base", {
		responseSchema: ActiveKnowledgeBaseDataSchema,
	});
	return active;
}

export async function selectKnowledgeBase(
	kbPath: string,
): Promise<ActiveContext> {
	const body = KnowledgeBaseContextBodySchema.parse({ kbPath });
	const { active } = await request("/api/knowledge-base", {
		method: "POST",
		body,
		responseSchema: ActiveKnowledgeBaseDataSchema,
	});
	if (!active) {
		throw new Error("选择知识库后未返回 active context");
	}
	return active;
}

export async function clearActiveContext(): Promise<void> {
	await request("/api/knowledge-base", {
		method: "DELETE",
		responseSchema: ActiveKnowledgeBaseDataSchema,
	});
}

export async function registerExternalKnowledgeBase(
	path: string,
): Promise<{ registered: boolean; info: KnowledgeBaseInfo }> {
	const data = await request("/api/knowledge-bases/external", {
		method: "POST",
		body: KnowledgeBasePathBodySchema.parse({ path }),
		responseSchema: RegisterExternalKnowledgeBaseDataSchema,
	});
	return { registered: data.registered, info: data.info };
}

export function inspectKnowledgeBasePath(
	path: string,
): Promise<InspectKnowledgeBasePathData> {
	return request("/api/knowledge-bases/inspect", {
		method: "POST",
		body: KnowledgeBasePathBodySchema.parse({ path }),
		responseSchema: InspectKnowledgeBasePathDataSchema,
	});
}

export async function unregisterExternalKnowledgeBase(
	path: string,
): Promise<{ removed: boolean }> {
	const data = await request("/api/knowledge-bases/external", {
		method: "DELETE",
		body: KnowledgeBasePathBodySchema.parse({ path }),
		responseSchema: UnregisterExternalKnowledgeBaseDataSchema,
	});
	return { removed: data.removed };
}
