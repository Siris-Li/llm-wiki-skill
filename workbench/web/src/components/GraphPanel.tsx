import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";
import {
	createGraphEngine,
	type GraphData,
	type GraphEngine,
	type ThemeId,
} from "@llm-wiki/graph-engine";

import {
	getGraphData,
	rebuildGraph,
	type GraphEvent,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
	currentKnowledgeBaseName: string | null;
	currentKnowledgeBasePath: string | null;
	theme: "dark" | "light";
	onToggleTheme?: () => void;
	onOpenPage?: (path: string) => void;
}

type GraphStatus = "idle" | "loading" | "building" | "ready" | "error";

export function GraphPanel({
	currentKnowledgeBaseName,
	currentKnowledgeBasePath,
	theme,
	onToggleTheme,
	onOpenPage,
}: Props) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const engineRef = useRef<GraphEngine | null>(null);
	const [data, setData] = useState<GraphData | null>(null);
	const [status, setStatus] = useState<GraphStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [buildState, setBuildState] = useState<"none" | "started" | "queued">("none");

	const graphTheme: ThemeId = theme === "dark" ? "mo-ye" : "shan-shui";

	const loadGraph = useCallback(async () => {
		if (!currentKnowledgeBasePath) {
			setData(null);
			setStatus("idle");
			setError(null);
			return;
		}
		setStatus((current) => (current === "building" ? "building" : "loading"));
		setError(null);
		try {
			const result = await getGraphData();
			if (result.needsBuild) {
				setData(null);
				setStatus("building");
				const nextBuildState = await rebuildGraph();
				setBuildState(nextBuildState);
				return;
			}
			setData(result.data);
			setStatus("ready");
			setBuildState("none");
		} catch (err) {
			setData(null);
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
		if (!hostRef.current || !data) {
			engineRef.current?.destroy();
			engineRef.current = null;
			return;
		}
		engineRef.current?.destroy();
		engineRef.current = createGraphEngine(hostRef.current, {
			data,
			theme: graphTheme,
			capabilities: {
				onOpenPage,
			},
		});
		return () => {
			engineRef.current?.destroy();
			engineRef.current = null;
		};
	}, [data, graphTheme, onOpenPage]);

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
			</div>
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
