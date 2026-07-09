import type {
	GraphData,
	GraphVisibilityState,
	PinMap,
	Selection,
} from "@llm-wiki/graph-engine";

import { closedDrawer, type DrawerState } from "./drawer-state";
import { shouldCloseDrawerAfterGraphSelectionClear } from "./graph-drawer-close";
import { sameGraphDrawerTarget } from "./graph-data-refresh";
import { drawerForGraphSelection } from "./graph-summary-actions";

export type ActiveMapReadingWorkflowEvent =
	| { type: "graph-selection-change"; selection: Selection | null };

export interface ActiveMapReadingWorkflowInput {
	event: ActiveMapReadingWorkflowEvent;
	data: GraphData | null;
	drawer: DrawerState;
	pins: PinMap;
	visibility: GraphVisibilityState | null;
	drawerExitProtected: boolean;
}

export interface ActiveMapReadingWorkflowPlan {
	drawer: DrawerState;
}

export function planActiveMapReadingWorkflow(input: ActiveMapReadingWorkflowInput): ActiveMapReadingWorkflowPlan {
	if (input.event.type === "graph-selection-change") {
		return planGraphSelectionChange(input, input.event.selection);
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

function unchangedPlan(drawer: DrawerState): ActiveMapReadingWorkflowPlan {
	return {
		drawer,
	};
}
