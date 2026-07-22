import {
	GraphLayoutDataSchema,
	GraphReadDataSchema,
	GraphRebuildDataSchema,
	GraphWarningPageDataSchema,
	type GraphAuthorityState,
	type GraphWarningPageContract,
	type GraphWarningStateContract,
} from "@llm-wiki/workbench-contracts";
import type { GraphData, GraphLayoutFile, PinMap } from "@llm-wiki/graph-engine";

import { request } from "./client";

export type GraphApiResult =
	| { state: Extract<GraphAuthorityState, { status: "error" }> }
	| {
			state: Extract<GraphAuthorityState, { status: "ready" }>;
			needsBuild: true;
	  }
	| {
			state: Extract<GraphAuthorityState, { status: "ready" }>;
			needsBuild: false;
			data: GraphData;
			warning_state: GraphWarningStateContract;
	  };

export type GraphBuildError = Pick<
	Extract<GraphAuthorityState, { status: "error" }>,
	"message" | "rebuiltAt"
> & { kbPath: string };

export interface GraphAuthoritySnapshot {
	kbPath: string;
	result: GraphApiResult;
}

export async function getGraphData(kbPath: string): Promise<GraphApiResult> {
	return (await request({ method: "GET", path: "/api/graph" }, {
		responseSchema: GraphReadDataSchema,
		query: { kb: kbPath },
	})) as GraphApiResult;
}

export async function rebuildGraph(
	kbPath: string,
): Promise<"started" | "queued"> {
	const data = await request({ method: "POST", path: "/api/graph/rebuild" }, {
		responseSchema: GraphRebuildDataSchema,
		query: { kb: kbPath },
	});
	return data.status;
}

export async function getGraphWarnings(
	kbPath: string,
	cursor?: string,
	limit?: number,
): Promise<GraphWarningPageContract> {
	return request({ method: "GET", path: "/api/graph/warnings" }, {
		responseSchema: GraphWarningPageDataSchema,
		query: { kb: kbPath, cursor, limit },
	});
}

export async function getGraphLayout(
	kbPath: string,
): Promise<GraphLayoutFile> {
	return (await request({ method: "GET", path: "/api/graph/layout" }, {
		responseSchema: GraphLayoutDataSchema,
		query: { kb: kbPath },
	})) as GraphLayoutFile;
}

export async function putGraphLayout(
	kbPath: string,
	pins: PinMap,
): Promise<GraphLayoutFile> {
	return (await request({ method: "PUT", path: "/api/graph/layout" }, {
		responseSchema: GraphLayoutDataSchema,
		body: { kbPath, version: 2, pins },
	})) as GraphLayoutFile;
}
