import type { DrawerState } from "./drawer-state";

export interface GraphDrawerClearCommand {
	id: string;
	type: "clear" | "clear-selection";
}

export function graphCloseCommandForDrawer(
	drawer: DrawerState,
	reason: "button" | "escape",
): GraphDrawerClearCommand | null {
	if (drawer.mode !== "graph-reader" && drawer.mode !== "graph-selection" && drawer.mode !== "graph-community-summary") return null;
	if (drawer.mode === "graph-reader" && reason === "button") return null;
	const type: "clear" | "clear-selection" = reason === "button" ? "clear-selection" : "clear";
	return { id: Math.random().toString(36).slice(2, 10), type };
}
