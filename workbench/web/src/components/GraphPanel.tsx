import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Moon, Plus, RefreshCw, RotateCcw, Send, Sun, X } from "lucide-react";
import {
	createGraphEngine,
	type GraphData,
	type GraphEngine,
	type PinMap,
	type Selection,
	type SelectionAction,
	type ThemeId,
} from "@llm-wiki/graph-engine";

import {
	getGraphData,
	getGraphLayout,
	putGraphLayout,
	rebuildGraph,
	type GraphEvent,
} from "@/lib/api";
import { buildSelectionPromptPayload, selectionTitle } from "@/lib/graph-selection";
import { cn } from "@/lib/utils";

interface Props {
	currentKnowledgeBaseName: string | null;
	currentKnowledgeBasePath: string | null;
	theme: "dark" | "light";
	onToggleTheme?: () => void;
	onOpenPage?: (path: string) => void;
	onAskSelection?: (input: { message: string; displayText: string; newConversation: boolean }) => void;
}

type GraphStatus = "idle" | "loading" | "building" | "ready" | "error";

interface ResetNotice {
	pins: PinMap;
	count: number;
}

export function GraphPanel({
	currentKnowledgeBaseName,
	currentKnowledgeBasePath,
	theme,
	onToggleTheme,
	onOpenPage,
	onAskSelection,
}: Props) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const engineRef = useRef<GraphEngine | null>(null);
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const resetNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [data, setData] = useState<GraphData | null>(null);
	const [layoutPins, setLayoutPins] = useState<PinMap>({});
	const [resetNotice, setResetNotice] = useState<ResetNotice | null>(null);
	const [status, setStatus] = useState<GraphStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [buildState, setBuildState] = useState<"none" | "started" | "queued">("none");
	const [selection, setSelection] = useState<Selection | null>(null);
	const [selectionText, setSelectionText] = useState("");

	const graphTheme: ThemeId = theme === "dark" ? "mo-ye" : "shan-shui";

	const loadGraph = useCallback(async () => {
		if (!currentKnowledgeBasePath) {
			setData(null);
			setLayoutPins({});
			setSelection(null);
			setStatus("idle");
			setError(null);
			return;
		}
		setStatus((current) => (current === "building" ? "building" : "loading"));
		setError(null);
		try {
			const [result, layout] = await Promise.all([getGraphData(), getGraphLayout()]);
			setLayoutPins(layout.layout.pins);
			if (result.needsBuild) {
				setData(null);
				setSelection(null);
				setStatus("building");
				const nextBuildState = await rebuildGraph();
				setBuildState(nextBuildState);
				return;
			}
			setData(result.data);
			setSelection(null);
			setStatus("ready");
			setBuildState("none");
		} catch (err) {
			setData(null);
			setLayoutPins({});
			setSelection(null);
			setStatus("error");
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [currentKnowledgeBasePath]);

	useEffect(() => {
		void loadGraph();
	}, [loadGraph]);

	useEffect(() => {
		if (!currentKnowledgeBasePath) return;
		const events = new EventSource("/api/events");
		events.addEventListener("graph_updated", (message) => {
			const event = JSON.parse((message as MessageEvent).data) as GraphEvent;
			if (event.type === "graph_updated" && event.kbPath === currentKnowledgeBasePath) {
				void loadGraph();
			}
		});
		events.addEventListener("graph_error", (message) => {
			const event = JSON.parse((message as MessageEvent).data) as GraphEvent;
			if (event.type === "graph_error" && event.kbPath === currentKnowledgeBasePath) {
				setStatus("error");
				setError(event.message);
				setBuildState("none");
			}
		});
		return () => events.close();
	}, [currentKnowledgeBasePath, loadGraph]);

	useEffect(() => {
		return () => {
			if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
			if (resetNoticeTimerRef.current) window.clearTimeout(resetNoticeTimerRef.current);
		};
	}, []);

	const persistPins = useCallback(async (pins: PinMap): Promise<void> => {
		setLayoutPins(pins);
		if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
		persistTimerRef.current = window.setTimeout(() => {
			void putGraphLayout(pins).catch((err) => {
				setError(err instanceof Error ? err.message : String(err));
			});
		}, 280);
	}, []);

	const writePinsImmediately = useCallback(async (pins: PinMap): Promise<void> => {
		setLayoutPins(pins);
		if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
		try {
			await putGraphLayout(pins);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const dismissResetNoticeLater = useCallback(() => {
		if (resetNoticeTimerRef.current) window.clearTimeout(resetNoticeTimerRef.current);
		resetNoticeTimerRef.current = window.setTimeout(() => {
			setResetNotice(null);
			resetNoticeTimerRef.current = null;
		}, 8000);
	}, []);

	const resetLayout = useCallback(() => {
		const previousPins = layoutPins;
		const previousCount = Object.keys(previousPins).length;
		engineRef.current?.resetLayout();
		if (previousCount === 0) {
			setResetNotice(null);
			return;
		}
		setResetNotice({ pins: previousPins, count: previousCount });
		dismissResetNoticeLater();
	}, [dismissResetNoticeLater, layoutPins]);

	const undoResetLayout = useCallback(() => {
		const notice = resetNotice;
		if (!notice) return;
		if (resetNoticeTimerRef.current) window.clearTimeout(resetNoticeTimerRef.current);
		resetNoticeTimerRef.current = null;
		setResetNotice(null);
		void writePinsImmediately(notice.pins);
	}, [resetNotice, writePinsImmediately]);

	useEffect(() => {
		if (!hostRef.current || !data) {
			engineRef.current?.destroy();
			engineRef.current = null;
			return;
		}
		engineRef.current?.destroy();
		engineRef.current = createGraphEngine(hostRef.current, {
			data,
			pins: layoutPins,
			theme: graphTheme,
			capabilities: {
				onOpenPage,
				onAsk: setSelection,
				persistPins,
			},
		});
		return () => {
			engineRef.current?.destroy();
			engineRef.current = null;
		};
	}, [data, graphTheme, layoutPins, onOpenPage, persistPins]);

	const selectNeighbors = useCallback(() => {
		if (!selection || selection.nodeIds.length !== 1) return;
		const next = engineRef.current?.select({ kind: "neighbors", id: selection.nodeIds[0] });
		if (next) setSelection(next);
	}, [selection]);

	const askSelection = useCallback((action: SelectionAction | null, newConversation: boolean) => {
		if (!data || !selection || !onAskSelection) return;
		const payload = buildSelectionPromptPayload(data, selection, action, selectionText);
		onAskSelection({
			message: payload.expandedText,
			displayText: payload.displayText,
			newConversation
		});
		setSelectionText("");
	}, [data, onAskSelection, selection, selectionText]);

	return (
		<div className="graph-screen" data-graph-status={status} data-graph-theme={graphTheme}>
			<header className="statusbar">
				<div className="statusbar-left">
					<span className={cn("status-dot", status === "building" && "status-dot-warn", status === "error" && "status-dot-error")} />
					<span className="status-kb">
						{currentKnowledgeBaseName ?? <span className="italic opacity-60">未选择</span>}
					</span>
					<span className="status-pill">图谱</span>
				</div>
				<div className="statusbar-right">
					<button
						type="button"
						className="status-pill status-pill-button"
						onClick={onToggleTheme}
						title={theme === "dark" ? "切换浅色主题" : "切换暗色主题"}
						aria-label={theme === "dark" ? "切换浅色主题" : "切换暗色主题"}
					>
						{theme === "dark" ? <Moon /> : <Sun />}
					</button>
					<button
						type="button"
						className="status-pill status-pill-button"
						onClick={resetLayout}
						disabled={!currentKnowledgeBasePath || status !== "ready"}
						title="重置布局"
					>
						<RotateCcw />
						重置布局
					</button>
					<button
						type="button"
						className="status-pill status-pill-button"
						onClick={() => {
							setStatus("building");
							void rebuildGraph()
								.then((next) => setBuildState(next))
								.catch((err) => {
									setStatus("error");
									setError(err instanceof Error ? err.message : String(err));
								});
						}}
						disabled={!currentKnowledgeBasePath || status === "building"}
						title="重新构建图谱"
					>
						<RefreshCw className={cn(status === "building" && "animate-spin")} />
						重构
					</button>
				</div>
			</header>

			<div className="graph-stage">
				<div ref={hostRef} className={cn("graph-host", !data && "graph-host-empty")} />
				{status !== "ready" && (
					<div className="graph-state" data-testid="graph-state">
						<div className="graph-state-title">{statusTitle(status)}</div>
						<div className="graph-state-copy">
							{statusCopy(status, Boolean(currentKnowledgeBasePath), buildState, error)}
						</div>
					</div>
				)}
				{status === "ready" && data && (
					<div className="graph-metrics">
						<span>{data.nodes.length} 节点</span>
						<span>{data.edges.length} 关联</span>
					</div>
				)}
				{resetNotice && (
					<div className="graph-toast" role="status">
						<span>已重置 {resetNotice.count} 个钉位</span>
						<button type="button" onClick={undoResetLayout}>
							撤销
						</button>
					</div>
				)}
				{status === "ready" && data && selection && (
					<SelectionPanel
						title={selectionTitle(data, selection)}
						selection={selection}
						freeText={selectionText}
						onFreeTextChange={setSelectionText}
						onClose={() => setSelection(null)}
						onNeighbors={selectNeighbors}
						onAsk={(action) => askSelection(action, false)}
						onAskInNewConversation={(action) => askSelection(action, true)}
					/>
				)}
			</div>
		</div>
	);
}

function SelectionPanel({
	title,
	selection,
	freeText,
	onFreeTextChange,
	onClose,
	onNeighbors,
	onAsk,
	onAskInNewConversation,
}: {
	title: string;
	selection: Selection;
	freeText: string;
	onFreeTextChange: (value: string) => void;
	onClose: () => void;
	onNeighbors: () => void;
	onAsk: (action: SelectionAction | null) => void;
	onAskInNewConversation: (action: SelectionAction | null) => void;
}) {
	const canExpandNeighbors = selection.nodeIds.length === 1;
	const canSendFreeText = freeText.trim().length > 0;
	const defaultAction = selection.actions?.[0] ?? null;
	return (
		<aside className="graph-selection-panel" data-testid="graph-selection-panel">
			<div className="graph-selection-head">
				<div className="min-w-0">
					<div className="graph-selection-kicker">选区</div>
					<div className="graph-selection-title" title={title}>{title}</div>
				</div>
				<button type="button" className="icon-btn" onClick={onClose} aria-label="关闭选区">
					<X />
				</button>
			</div>
			<div className="graph-selection-facts">
				<Fact label="页" value={selection.facts.pageCount} />
				<Fact label="链接" value={selection.facts.internalLinkCount} />
				<Fact label="社区" value={selection.facts.communityCount} />
				<Fact label="孤立" value={selection.facts.isolatedCount} />
			</div>
			<div className="graph-selection-actions">
				<button
					type="button"
					className="graph-selection-action graph-selection-action-muted"
					onClick={onNeighbors}
					disabled={!canExpandNeighbors}
				>
					<Plus />
					邻居一跳
				</button>
				{selection.actions?.map((action) => (
					<button
						key={action.id}
						type="button"
						className="graph-selection-action"
						data-action-id={action.id}
						onClick={() => onAsk(action)}
					>
						<Send />
						{action.label}
					</button>
				))}
			</div>
			<textarea
				className="graph-selection-textarea"
				value={freeText}
				onChange={(event) => onFreeTextChange(event.target.value)}
				rows={3}
				placeholder="自由输入…"
			/>
			<div className="graph-selection-footer">
				<button
					type="button"
					className="graph-selection-send"
					onClick={() => onAsk(null)}
					disabled={!canSendFreeText}
				>
					<Send />
					发送
				</button>
				<button
					type="button"
					className="graph-selection-secondary"
					onClick={() => onAskInNewConversation(canSendFreeText ? null : defaultAction)}
					disabled={!canSendFreeText && !defaultAction}
				>
					<MessageSquarePlus />
					新对话
				</button>
			</div>
		</aside>
	);
}

function Fact({ label, value }: { label: string; value: number }) {
	return (
		<div className="graph-selection-fact">
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
}

function statusTitle(status: GraphStatus): string {
	if (status === "idle") return "选择知识库后查看图谱";
	if (status === "loading") return "正在读取图谱";
	if (status === "building") return "图谱构建中";
	if (status === "error") return "图谱暂时不可用";
	return "";
}

function statusCopy(
	status: GraphStatus,
	hasKnowledgeBase: boolean,
	buildState: "none" | "started" | "queued",
	error: string | null,
): string {
	if (!hasKnowledgeBase) return "左侧选择一个知识库后，这里会显示它的结构地图。";
	if (status === "loading") return "正在读取当前知识库的图谱数据。";
	if (status === "building") {
		return buildState === "queued"
			? "已有构建在进行，新的构建请求已排队。"
			: "还没有图谱数据，正在后台构建。完成后会自动刷新。";
	}
	if (status === "error") return error ?? "请稍后重试。";
	return "";
}
