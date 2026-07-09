import {
	resolveSelection,
	type GraphData,
	type GraphOpenPagePayload,
	type GraphSummaryCommand,
	type GraphSummaryObjectRef,
	type GraphVisibilityState,
	type PinMap,
	type Selection,
} from "@llm-wiki/graph-engine";

import { closedDrawer, type DrawerState } from "./drawer-state";
import type { GraphReaderActionId } from "./graph-reader";
import { graphCloseCommandForDrawer, shouldCloseDrawerAfterGraphSelectionClear } from "./graph-drawer-close";
import {
	drawerAfterGraphDataRefresh,
	drawerForGraphNodeVisibility,
	graphReaderFilteredHidden,
	graphReaderStaleAfterRefresh,
	sameGraphDrawerTarget,
	temporaryObjectAfterGraphDataRefresh,
	visibilityWithTemporaryObject,
} from "./graph-data-refresh";
import { planCommunityEnterExit } from "./graph-community-enter";
import {
	graphCommunityDrawerViewModel,
	graphGroupDrawerPromptAction,
	graphSelectionGroupDrawerViewModel,
} from "./graph-group-drawer";
import { buildSelectionPromptPayload } from "./graph-selection";
import {
	drawerForGraphSelection,
	drawerForGraphSummaryNode,
	graphOpenPagePayloadForCommand,
	graphSelectionCommandForOpenDetail,
	graphSelectionCommandForSummaryCommand,
	type GraphSelectionCommand,
} from "./graph-summary-actions";

export type ActiveMapReadingWorkflowEvent =
	| { type: "graph-selection-change"; selection: Selection | null }
	| { type: "graph-visibility-change" }
	| { type: "graph-data-change"; temporaryObject?: GraphSummaryObjectRef | null }
	| { type: "graph-view-reset" }
	| { type: "graph-reader-action"; actionId: GraphReaderActionId }
	| { type: "graph-selection-ask"; actionId: string | null; newConversation: boolean }
	| { type: "graph-community-ask"; actionId: string | null; newConversation: boolean }
	| { type: "graph-summary-command"; command: GraphSummaryCommand; reducedMotion?: boolean }
	| { type: "graph-summary-node-select"; nodeId: string }
	| { type: "graph-summary-node-preview"; nodeId: string | null }
	| { type: "graph-summary-return-community"; communityId: string }
	| { type: "graph-drawer-close"; reason: "button" | "escape" };

export interface ActiveMapReadingWorkflowInput {
	event: ActiveMapReadingWorkflowEvent;
	data: GraphData | null;
	drawer: DrawerState;
	pins: PinMap;
	visibility: GraphVisibilityState | null;
	temporaryObject?: GraphSummaryObjectRef | null;
	drawerExitProtected: boolean;
	createCommandId?: (prefix: string) => string;
}

export interface ActiveMapReadingWorkflowPlan {
	drawer: DrawerState;
	selectionCommand?: GraphSelectionCommand;
	conversationHandoff?: {
		message: string;
		displayText: string;
		newConversation: boolean;
	};
	pageReadRequest?: {
		payload: GraphOpenPagePayload;
		syncGraphFocus: boolean;
	};
	drawerExit?: { drawer: DrawerState; durationMs: number } | null;
	temporaryObject?: GraphSummaryObjectRef | null;
	clearGraphFocusPath?: boolean;
}

export function planActiveMapReadingWorkflow(input: ActiveMapReadingWorkflowInput): ActiveMapReadingWorkflowPlan {
	if (input.event.type === "graph-selection-change") {
		return planGraphSelectionChange(input, input.event.selection);
	}
	if (input.event.type === "graph-visibility-change") {
		return planGraphVisibilityChange(input);
	}
	if (input.event.type === "graph-data-change") {
		return planGraphDataChange(
			input,
			"temporaryObject" in input.event ? input.event.temporaryObject ?? null : input.temporaryObject ?? null,
		);
	}
	if (input.event.type === "graph-view-reset") {
		return planGraphViewReset(input);
	}
	if (input.event.type === "graph-reader-action") {
		return planGraphReaderAction(input, input.event.actionId);
	}
	if (input.event.type === "graph-selection-ask") {
		return planGraphSelectionAsk(input, input.event.actionId, input.event.newConversation);
	}
	if (input.event.type === "graph-community-ask") {
		return planGraphCommunityAsk(input, input.event.actionId, input.event.newConversation);
	}
	if (input.event.type === "graph-summary-command") {
		return planGraphSummaryCommand(input, input.event.command, input.event.reducedMotion ?? false);
	}
	if (input.event.type === "graph-summary-node-select") {
		return unchangedPlan(drawerForGraphSummaryNode(input.data, input.event.nodeId, input.drawer, { pins: input.pins }));
	}
	if (input.event.type === "graph-summary-node-preview") {
		return {
			...unchangedPlan(input.drawer),
			selectionCommand: {
				id: commandId(input, `preview-${input.event.nodeId ?? "clear"}`),
				nodeId: input.event.nodeId,
				type: "preview-node",
			},
		};
	}
	if (input.event.type === "graph-summary-return-community") {
		return {
			...unchangedPlan(input.drawer),
			selectionCommand: { id: input.event.communityId, type: "select-community-summary" },
		};
	}
	if (input.event.type === "graph-drawer-close") {
		return planGraphDrawerClose(input, input.event.reason);
	}
	return unchangedPlan(input.drawer);
}

function planGraphSelectionChange(
	input: ActiveMapReadingWorkflowInput,
	selection: Selection | null,
): ActiveMapReadingWorkflowPlan {
	if (!selection) {
		if (input.drawerExitProtected) return unchangedPlan(input.drawer);
		return unchangedPlan(shouldCloseDrawerAfterGraphSelectionClear(input.drawer) ? closedDrawer() : input.drawer);
	}

	if (
		input.drawer.mode === "graph-reader"
		&& selection.nodeIds.length === 1
		&& input.drawer.payload.node.id === selection.nodeIds[0]
	) {
		return unchangedPlan(input.drawer);
	}

	const nextDrawer = drawerForGraphSelection(input.data, selection, input.drawer, {
		pins: input.pins,
		selection: selection.input,
		searchResultIds: input.visibility?.searchResultIds ?? [],
	});
	return unchangedPlan(sameGraphDrawerTarget(input.drawer, nextDrawer) ? input.drawer : nextDrawer);
}

function planGraphVisibilityChange(input: ActiveMapReadingWorkflowInput): ActiveMapReadingWorkflowPlan {
	const temporaryObject = temporaryObjectAfterGraphDataRefresh(input.data, input.visibility?.temporaryObject ?? null);
	const visibility = visibilityWithTemporaryObject(input.visibility, temporaryObject);
	if (input.drawerExitProtected) return {
		...unchangedPlan(input.drawer),
		temporaryObject,
	};

	if (input.drawer.mode === "graph-node-summary") {
		if (
			visibility?.temporaryObject?.kind === "node"
			&& visibility.temporaryObject.nodeId === input.drawer.payload.nodeId
			&& input.drawer.payload.commands.some((command) => command.kind === "clear-temporary-object-display")
		) {
			return {
				...unchangedPlan(input.drawer),
				temporaryObject,
			};
		}
		const next = drawerForGraphNodeVisibility(input.data, input.drawer.payload.nodeId, input.drawer, {
			pins: input.pins,
			visibility,
		});
		return {
			...unchangedPlan(sameGraphDrawerTarget(input.drawer, next) ? input.drawer : next),
			temporaryObject,
		};
	}

	if (input.drawer.mode === "graph-excluded-object" && input.drawer.payload.object.kind === "node") {
		const next = drawerForGraphNodeVisibility(input.data, input.drawer.payload.object.nodeId, input.drawer, {
			pins: input.pins,
			visibility,
		});
		return {
			...unchangedPlan(sameGraphDrawerTarget(input.drawer, next) ? input.drawer : next),
			temporaryObject,
		};
	}

	if (input.drawer.mode === "graph-reader") {
		const filteredHidden = graphReaderFilteredHidden(input.drawer.payload.node.id, visibility);
		return {
			...unchangedPlan(input.drawer.filteredHidden === filteredHidden ? input.drawer : {
				...input.drawer,
				filteredHidden,
			}),
			temporaryObject,
		};
	}

	return {
		...unchangedPlan(input.drawer),
		temporaryObject,
	};
}

function planGraphDataChange(
	input: ActiveMapReadingWorkflowInput,
	currentTemporaryObject: GraphSummaryObjectRef | null,
): ActiveMapReadingWorkflowPlan {
	const temporaryObject = temporaryObjectAfterGraphDataRefresh(input.data, currentTemporaryObject);
	if (input.drawerExitProtected) return {
		...unchangedPlan(input.drawer),
		temporaryObject,
	};
	const effectiveVisibility = visibilityWithTemporaryObject(input.visibility, temporaryObject);
	const readerStale = graphReaderStaleAfterRefresh(input.drawer, input.data, effectiveVisibility);
	const next = drawerAfterGraphDataRefresh(input.drawer, input.data, {
		pins: input.pins,
		visibility: input.visibility,
		temporaryObject,
	});
	return {
		drawer: sameGraphDrawerTarget(input.drawer, next) ? input.drawer : next,
		temporaryObject,
		...(readerStale
			? {
				clearGraphFocusPath: true,
				selectionCommand: {
					id: commandId(input, "clear-stale-reader"),
					type: "clear-selection" as const,
				},
			}
			: {}),
	};
}

function planGraphViewReset(input: ActiveMapReadingWorkflowInput): ActiveMapReadingWorkflowPlan {
	return {
		drawer: input.drawer.mode === "graph-reader"
			? drawerForGraphSummaryNode(input.data, input.drawer.payload.node.id, input.drawer, { pins: input.pins })
			: input.drawer,
		clearGraphFocusPath: true,
	};
}

function planGraphReaderAction(
	input: ActiveMapReadingWorkflowInput,
	actionId: GraphReaderActionId,
): ActiveMapReadingWorkflowPlan {
	if (input.drawer.mode === "graph-reader" && actionId === "find_related_pages") {
		return {
			...unchangedPlan(input.drawer),
			selectionCommand: {
				id: input.drawer.payload.node.id,
				type: "neighbors",
			},
		};
	}
	if (!input.data || input.drawer.mode !== "graph-reader") return unchangedPlan(input.drawer);
	const selection = resolveSelection(input.data, { kind: "node", id: input.drawer.payload.node.id });
	const action = selection.actions?.find((item) => item.id === actionId) ?? null;
	const payload = buildSelectionPromptPayload(input.data, selection, action, "");
	return {
		...unchangedPlan(closedDrawer()),
		selectionCommand: {
			id: commandId(input, "clear-graph-reader-after-ask"),
			type: "clear",
		},
		conversationHandoff: {
			message: payload.expandedText,
			displayText: payload.displayText,
			newConversation: false,
		},
	};
}

function planGraphSelectionAsk(
	input: ActiveMapReadingWorkflowInput,
	actionId: string | null,
	newConversation: boolean,
): ActiveMapReadingWorkflowPlan {
	if (!input.data || input.drawer.mode !== "graph-selection") return unchangedPlan(input.drawer);
	const recommendedActionId = graphSelectionGroupDrawerViewModel(input.drawer.title, input.drawer.selection).recommendedActionId;
	const action = graphGroupDrawerPromptAction(actionId, recommendedActionId, input.drawer.freeText, newConversation);
	const payload = buildSelectionPromptPayload(input.data, input.drawer.selection, action, input.drawer.freeText);
	return graphAskPlan(input, payload.expandedText, payload.displayText, newConversation, "clear-graph-selection-after-ask");
}

function planGraphCommunityAsk(
	input: ActiveMapReadingWorkflowInput,
	actionId: string | null,
	newConversation: boolean,
): ActiveMapReadingWorkflowPlan {
	if (!input.data || input.drawer.mode !== "graph-community-summary") return unchangedPlan(input.drawer);
	const selection = resolveSelection(input.data, { kind: "community", id: input.drawer.payload.communityId });
	const recommendedActionId = graphCommunityDrawerViewModel(input.drawer.payload).recommendedActionId;
	const action = graphGroupDrawerPromptAction(actionId, recommendedActionId, input.drawer.freeText, newConversation);
	const payload = buildSelectionPromptPayload(input.data, selection, action, input.drawer.freeText);
	return graphAskPlan(input, payload.expandedText, payload.displayText, newConversation, "clear-graph-community-after-ask");
}

function graphAskPlan(
	input: ActiveMapReadingWorkflowInput,
	message: string,
	displayText: string,
	newConversation: boolean,
	commandPrefix: string,
): ActiveMapReadingWorkflowPlan {
	return {
		...unchangedPlan(closedDrawer()),
		selectionCommand: {
			id: commandId(input, commandPrefix),
			type: "clear",
		},
		conversationHandoff: {
			message,
			displayText,
			newConversation,
		},
	};
}

function planGraphSummaryCommand(
	input: ActiveMapReadingWorkflowInput,
	command: GraphSummaryCommand,
	reducedMotion: boolean,
): ActiveMapReadingWorkflowPlan {
	if (command.kind === "open-detail-read" || command.kind === "enter-node-community") {
		const payload = graphOpenPagePayloadForCommand(input.data, command);
		const focusCommand = command.kind === "open-detail-read"
			? graphSelectionCommandForOpenDetail(input.data, command)
			: graphSelectionCommandForSummaryCommand(command);
		const selectionCommand = focusCommand?.type === "enter-community-node"
			? {
				...focusCommand,
				...(command.kind === "open-detail-read"
					? { commandId: commandId(input, `open-detail-${command.nodeId}`) }
					: {}),
			}
			: undefined;
		return {
			...unchangedPlan(input.drawer),
			...(selectionCommand ? { selectionCommand } : {}),
			...(payload
				? { pageReadRequest: { payload, syncGraphFocus: focusCommand?.type !== "enter-community-node" } }
				: {}),
		};
	}

	if (command.kind === "enter-community") {
		const plan = planCommunityEnterExit({
			communityId: command.communityId,
			drawer: input.drawer,
			reducedMotion,
		});
		return {
			drawer: plan.exit ? input.drawer : closedDrawer(),
			selectionCommand: plan.selectionCommand,
			drawerExit: plan.exit,
		};
	}

	if (command.kind === "select-neighbors") {
		const selectionCommand = graphSelectionCommandForSummaryCommand(command);
		return {
			...unchangedPlan(input.drawer),
			...(selectionCommand ? { selectionCommand } : {}),
		};
	}

	if (command.kind === "set-fixed-position") {
		return {
			...unchangedPlan(input.drawer),
			selectionCommand: {
				id: commandId(input, `${command.mode}-${command.nodeId}`),
				nodeId: command.nodeId,
				mode: command.mode,
				type: "set-fixed-position",
			},
		};
	}

	if (command.kind === "show-this-object") {
		const visibility = visibilityWithTemporaryObject(input.visibility, command.object);
		const nextDrawer = command.object.kind === "node"
			? drawerForGraphNodeVisibility(input.data, command.object.nodeId, input.drawer, {
				pins: input.pins,
				visibility,
			})
			: input.drawer;
		return {
			drawer: sameGraphDrawerTarget(input.drawer, nextDrawer) ? input.drawer : nextDrawer,
			temporaryObject: command.object,
			selectionCommand: {
				id: commandId(input, "show-temporary-object"),
				object: command.object,
				type: "show-temporary-object",
			},
		};
	}

	if (command.kind === "clear-temporary-object-display") {
		const nextDrawer = input.drawer.mode === "graph-node-summary"
			? drawerForGraphNodeVisibility(input.data, input.drawer.payload.nodeId, input.drawer, {
				pins: input.pins,
				visibility: input.visibility ? { ...input.visibility, temporaryObject: null } : null,
			})
			: input.drawer;
		return {
			drawer: sameGraphDrawerTarget(input.drawer, nextDrawer) ? input.drawer : nextDrawer,
			temporaryObject: null,
			selectionCommand: {
				id: commandId(input, "clear-temporary-object-display"),
				type: "clear-temporary-object-display",
			},
		};
	}

	return unchangedPlan(input.drawer);
}

function planGraphDrawerClose(
	input: ActiveMapReadingWorkflowInput,
	reason: "button" | "escape",
): ActiveMapReadingWorkflowPlan {
	const clearCommand = graphCloseCommandForDrawer(input.drawer, reason);
	if (!clearCommand) return unchangedPlan(closedDrawer());
	return {
		drawer: clearCommand.type === "select-community-summary" ? input.drawer : closedDrawer(),
		selectionCommand: clearCommand,
		clearGraphFocusPath: true,
	};
}

function unchangedPlan(drawer: DrawerState): ActiveMapReadingWorkflowPlan {
	return {
		drawer,
	};
}

function commandId(input: ActiveMapReadingWorkflowInput, prefix: string): string {
	return input.createCommandId?.(prefix) ?? `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
