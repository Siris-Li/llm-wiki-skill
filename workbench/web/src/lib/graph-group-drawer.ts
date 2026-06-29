import type {
	GraphCommunitySummaryPayload,
	Selection,
	SelectionAction,
	SelectionActionId,
	SelectionActionTone
} from "@llm-wiki/graph-engine";

export interface GraphGroupDrawerFact {
	label: string;
	value: number;
}

export interface GraphGroupDrawerAction extends SelectionAction {
	recommended: boolean;
}

export interface GraphGroupDrawerNode {
	nodeId: string;
	label: string;
	role: string;
}

export interface GraphGroupDrawerViewModel {
	kicker: string;
	title: string;
	description: string;
	canEnterCommunity: boolean;
	recommendedActionId: SelectionActionId;
	facts: GraphGroupDrawerFact[];
	tags: string[];
	actions: GraphGroupDrawerAction[];
	nodes: GraphGroupDrawerNode[];
}

const FIXED_GROUP_ACTIONS: Array<SelectionAction & { id: SelectionActionId; tone: SelectionActionTone }> = [
	{ id: "summarize_cluster", label: "总结这一簇", tone: "digest" },
	{ id: "find_knowledge_gaps", label: "找知识缺口", tone: "lint" },
	{ id: "create_topic_page", label: "生成主题页", tone: "write" },
	{ id: "explore_potential_links", label: "探索潜在关系", tone: "bridge" }
];

export function graphCommunityDrawerViewModel(payload: GraphCommunitySummaryPayload): GraphGroupDrawerViewModel {
	const recommendedActionId = recommendedActionForCommunity(payload);
	return {
		kicker: "社区",
		title: payload.label,
		description: payload.description,
		canEnterCommunity: payload.canEnterCommunity,
		recommendedActionId,
		facts: [
			{ label: "页", value: payload.facts.pageCount },
			{ label: "链接", value: payload.facts.internalLinkCount },
			{ label: "核心", value: payload.coreNodeIds.length },
			{ label: "孤立", value: payload.facts.isolatedCount }
		],
		tags: communityTags(payload),
		actions: FIXED_GROUP_ACTIONS.map((action) => ({
			...action,
			recommended: action.id === recommendedActionId
		})),
		nodes: payload.coreNodes.slice(0, 3).map((node) => ({
			nodeId: node.nodeId,
			label: node.label,
			role: node.role
		}))
	};
}

export function graphSelectionGroupDrawerViewModel(title: string, selection: Selection): GraphGroupDrawerViewModel {
	const recommendedActionId = recommendedActionForSelection(selection);
	return {
		kicker: "选区",
		title,
		description: "这些页面来自当前图谱选区。你可以直接让 agent 基于这组页面继续工作。",
		canEnterCommunity: false,
		recommendedActionId,
		facts: [
			{ label: "页", value: selection.facts.pageCount },
			{ label: "链接", value: selection.facts.internalLinkCount },
			{ label: "社区", value: selection.facts.communityCount },
			{ label: "孤立", value: selection.facts.isolatedCount }
		],
		tags: ["Shift+点击增删节点"],
		actions: FIXED_GROUP_ACTIONS.map((action) => ({
			...action,
			recommended: action.id === recommendedActionId
		})),
		nodes: selection.nodeIds.slice(0, 3).map((nodeId) => ({
			nodeId,
			label: nodeId,
			role: "已选"
		}))
	};
}

export function groupDrawerActionById(id: string | null): SelectionAction | null {
	if (!id) return null;
	return FIXED_GROUP_ACTIONS.find((action) => action.id === id) ?? null;
}

export function resolveCommunityAskAction(payload: GraphCommunitySummaryPayload, actionId: string | null): SelectionAction {
	const recommendedId = graphCommunityDrawerViewModel(payload).recommendedActionId;
	return groupDrawerActionById(actionId ?? recommendedId) ?? groupDrawerActionById(recommendedId)!;
}

function recommendedActionForCommunity(payload: GraphCommunitySummaryPayload): SelectionActionId {
	if (payload.structureState === "ungrouped") return "explore_potential_links";
	if (payload.structureState === "loose") return "find_knowledge_gaps";
	return "summarize_cluster";
}

function recommendedActionForSelection(selection: Selection): SelectionActionId {
	if (selection.facts.internalLinkCount === 0) return "explore_potential_links";
	if (selection.facts.communityCount > 1) return "explore_potential_links";
	return "summarize_cluster";
}

function communityTags(payload: GraphCommunitySummaryPayload): string[] {
	const tags = [structureLabel(payload.structureState)];
	if (payload.pinHints.length > 0) tags.push(`${payload.pinHints.length} 固定`);
	if (payload.searchResultIds.length > 0) tags.push(`${payload.searchResultIds.length} 命中`);
	return tags;
}

function structureLabel(state: GraphCommunitySummaryPayload["structureState"]): string {
	if (state === "ungrouped") return "暂未成组";
	if (state === "loose") return "结构松散";
	return "结构清晰";
}
