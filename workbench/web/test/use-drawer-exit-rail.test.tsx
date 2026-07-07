import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderHook, act } from "@testing-library/react";

import { useDrawerExitRail } from "../src/lib/use-drawer-exit-rail";
import { closedDrawer, wikiDrawer, type DrawerState } from "../src/lib/drawer-state";

describe("useDrawerExitRail", () => {
	it("stages an exit snapshot and reports exiting only while the drawer reference matches", () => {
		const drawer = wikiDrawer("wiki/a.md");
		const { result } = renderHook(() => useDrawerExitRail(drawer, noopSetDrawer));

		assert.equal(result.current.exitSnapshot, null);
		assert.equal(result.current.exitRef.current, null);
		assert.equal(result.current.isExiting, false);

		act(() => result.current.stage(drawer));
		assert.equal(result.current.exitSnapshot, drawer);
		assert.equal(result.current.exitRef.current, drawer);
		assert.equal(result.current.isExiting, true);

		act(() => result.current.stage(null));
		assert.equal(result.current.exitSnapshot, null);
		assert.equal(result.current.exitRef.current, null);
		assert.equal(result.current.isExiting, false);
	});

	it("clears the snapshot when the drawer reference changes (interrupt fallback)", () => {
		// 退场被打断（Escape / 知识库切换 / graphData 刷新让 drawer 引用变化）时，
		// RightDrawer 的退场定时器被 exiting=false 清掉，complete 不再触发；
		// hook 必须靠这条 effect 兜底清空 exitRef，否则两条守卫被永久短路。
		const drawerA = wikiDrawer("wiki/a.md");
		const drawerB = closedDrawer();
		const { result, rerender } = renderHook(
			({ d }: { d: DrawerState }) => useDrawerExitRail(d, noopSetDrawer),
			{ initialProps: { d: drawerA } },
		);

		act(() => result.current.stage(drawerA));
		assert.equal(result.current.exitRef.current, drawerA);

		rerender({ d: drawerB });
		assert.equal(result.current.exitSnapshot, null);
		assert.equal(result.current.exitRef.current, null);
		assert.equal(result.current.isExiting, false);
	});

	it("does not clear the snapshot when the drawer reference stays the same across rerenders", () => {
		const drawer = wikiDrawer("wiki/a.md");
		const { result, rerender } = renderHook(
			({ d }: { d: DrawerState }) => useDrawerExitRail(d, noopSetDrawer),
			{ initialProps: { d: drawer } },
		);

		act(() => result.current.stage(drawer));
		rerender({ d: drawer });
		assert.equal(result.current.exitRef.current, drawer);
		assert.equal(result.current.isExiting, true);
	});

	it("complete closes the drawer and clears the snapshot", () => {
		const sets: DrawerState[] = [];
		const drawer = wikiDrawer("wiki/a.md");
		const { result } = renderHook(() => useDrawerExitRail(drawer, (next) => sets.push(next)));

		act(() => result.current.stage(drawer));
		act(() => result.current.complete());

		assert.equal(sets.length, 1);
		assert.equal(sets[0]?.mode, "closed");
		assert.equal(result.current.exitSnapshot, null);
		assert.equal(result.current.exitRef.current, null);
	});
});

function noopSetDrawer(): void {}
