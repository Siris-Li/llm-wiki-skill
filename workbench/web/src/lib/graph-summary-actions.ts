import {
	graphNodeTypeLabel,
	summarizeGraphCommunity,
	summarizeGraphNode,
	wikiPathForGraphNode,
	type GraphData,
	type GraphOpenPagePayload,
	type GraphSummaryCommand,
	type Selection,
} from "@llm-wiki/graph-engine";

import {
	graphCommunitySummaryDrawer,
	graphNodeSummaryDrawer,
	graphSelectionDrawer,
	type DrawerState,
} from "./drawer-state";
import { selectionTitle } from "./graph-selection";

export type GraphSelectionCommand =
	| { id: string; type: "clear" | "clear-selection" | "neighbors" | "enter-community" }
	| { id: string; nodeId: string; type: "enter-community-node" };

export function drawerForGraphSelection(data: GraphData | null, selection: Selection, current: DrawerState): DrawerState {
	if (data && selection.nodeIds.length === 1) {
		const summary = summarizeGraphNode(data, selection.nodeIds[0], {
			selection: { kind: "node", id: selection.nodeIds[0] },
		});
		if (summary.kind === "node-summary") return graphNodeSummaryDrawer(summary);
	}

	if (data && selection.nodeIds.length > 1 && selection.communityIds.length === 1) {
		const summary = summarizeGraphCommunity(data, selection.communityIds[0], {
			selection: { kind: "community", id: selection.communityIds[0] },
		});
		if (summary.kind === "community-summary") return graphCommunitySummaryDrawer(summary);
	}

	const freeText = current.mode === "graph-selection" ? current.freeText : "";
	const title = data ? selectionTitle(data, selection) : "选区";
	return graphSelectionDrawer(selection, title, freeText);
}

export function graphOpenPagePayloadForCommand(data: GraphData | null, command: GraphSummaryCommand): GraphOpenPagePayload | null {
	if (command.kind !== "open-detail-read") return null;
	if (!data) {
		return fallbackPayloadForOpenDetail(command);
	}
	const node = data?.nodes.find((item) => item.id === command.nodeId) ?? null;
	if (!node) {
		return fallbackPayloadForOpenDetail(command);
	}
	const sourcePath = wikiPathForGraphNode(node);
	return {
		path: sourcePath,
		node: {
			id: node.id,
			title: node.label || node.id,
			type: node.type,
			typeLabel: graphNodeTypeLabel(node.type),
			sourcePath,
			community: node.community ?? null,
			date: typeof node.date === "string" ? node.date : null,
			source: typeof node.source === "string" ? node.source : null,
			isolated: isIsolatedNode(data, node.id),
		},
	};
}

export function graphSelectionCommandForOpenDetail(data: GraphData | null, command: GraphSummaryCommand): GraphSelectionCommand | null {
	if (command.kind !== "open-detail-read" || !data) return null;
	const node = data.nodes.find((item) => item.id === command.nodeId);
	if (!node?.community) return null;
	return { id: node.community, nodeId: node.id, type: "enter-community-node" };
}

function fallbackPayloadForOpenDetail(command: Extract<GraphSummaryCommand, { kind: "open-detail-read" }>): GraphOpenPagePayload {
	return {
		path: command.path,
		node: {
			id: command.nodeId,
			title: command.nodeId,
			type: "entity",
			typeLabel: "实体",
			sourcePath: command.path,
			community: null,
			date: null,
			source: null,
			isolated: true,
		},
	};
}

function isIsolatedNode(data: GraphData, id: string): boolean {
	return data.edges.every((edge) => edge.from !== id && edge.to !== id);
}
