import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import { closedDrawer, type DrawerState } from "./drawer-state";

/**
 * 进入社区退场轨道（#120）：把 drawerExit 状态、ref 同步、退场完成、打断兜底
 * 集中到一个 hook，让 App 只剩调用点，也让两条守卫（退场期间不要因 selection
 * clear / 数据刷新关闭或重建抽屉）有可测的载体。
 *
 * `exitRef` 暴露给 App 的两条 setDrawer 守卫用：updater 在 render 期运行，读 ref
 * 才能和 stage 的写入在同一渲染通道对齐（state 是异步的）。
 */
export interface DrawerExitRail {
	readonly exitSnapshot: DrawerState | null;
	readonly exitRef: MutableRefObject<DrawerState | null>;
	/** drawer === exitSnapshot：RightDrawer 的 exiting prop。引用守卫，退场被打断即翻 false。 */
	readonly isExiting: boolean;
	/** 暂存退场快照（或传 null 取消）。同步写 ref，异步写 state。 */
	stage: (snapshot: DrawerState | null) => void;
	/** 退场定时器到点：落回 closed 并清空快照。 */
	complete: () => void;
}

export function useDrawerExitRail(
	drawer: DrawerState,
	setDrawer: (next: DrawerState) => void,
): DrawerExitRail {
	const [exitSnapshot, setExitSnapshot] = useState<DrawerState | null>(null);
	const exitRef = useRef<DrawerState | null>(null);

	const stage = useCallback((snapshot: DrawerState | null): void => {
		exitRef.current = snapshot;
		setExitSnapshot(snapshot);
	}, []);

	const complete = useCallback((): void => {
		setDrawer(closedDrawer());
		stage(null);
	}, [setDrawer, stage]);

	// 打断兜底：drawer 引用变化（!== 退场快照）说明退场被异步事件打断
	// （Escape / 知识库切换 / graphData 刷新等），RightDrawer 的退场定时器已被
	// exiting=false 清掉，complete 不会再触发。此时必须清空 exitRef，否则两条
	// 守卫会被永久短路——后续 clearSelection 被吞、drawerAfterGraphDataRefresh 永久跳过。
	useEffect(() => {
		if (exitSnapshot && drawer !== exitSnapshot) {
			stage(null);
		}
	}, [drawer, exitSnapshot, stage]);

	return {
		exitSnapshot,
		exitRef,
		isExiting: exitSnapshot != null && drawer === exitSnapshot,
		stage,
		complete,
	};
}
