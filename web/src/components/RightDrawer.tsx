import { type CSSProperties, useEffect, useRef } from "react";

import { Download, FileText, Maximize2, Minimize2, X } from "lucide-react";

import { ArtifactView } from "@/components/ArtifactView";
import { MarkdownView } from "@/components/MarkdownView";
import { getArtifactFileUrl, type ArtifactManifest } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
	mode: "closed" | "wiki" | "artifacts";
	wiki: {
		path: string | null;
		content: string;
		loading: boolean;
		error: string | null;
	};
	artifacts: ArtifactManifest[];
	activeArtifactId: string | null;
	fullscreen: boolean;
	width: number;
	defaultWidth: number;
	onSelectArtifact: (id: string) => void;
	onResize: (width: number) => void;
	onToggleFullscreen: () => void;
	onClose: () => void;
}

const KIND_ICON: Record<ArtifactManifest["kind"], string> = {
	html: "🌐",
	pdf: "📄",
	docx: "📝",
	pptx: "📊",
	xlsx: "📋",
};

export function RightDrawer({
	mode,
	wiki,
	artifacts,
	activeArtifactId,
	fullscreen,
	width,
	defaultWidth,
	onSelectArtifact,
	onResize,
	onToggleFullscreen,
	onClose,
}: Props) {
	const dragStart = useRef<{ x: number; width: number } | null>(null);

	useEffect(() => {
		return () => {
			document.body.classList.remove("drawer-resizing");
		};
	}, []);

	useEffect(() => {
		if (mode === "closed") return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [mode, onClose]);

	if (mode === "closed") return null;
	const activeArtifact = artifacts.find((item) => item.id === activeArtifactId) ?? null;
	return (
		<aside
			className={cn("drawer-panel drawer-panel-open", fullscreen && "drawer-panel-fullscreen")}
			style={{ "--drawer-width": `${width}px` } as CSSProperties}
		>
			{!fullscreen && (
				<div
					className="drawer-resize-handle"
					role="separator"
					aria-label="调整预览区宽度"
					aria-orientation="vertical"
					tabIndex={0}
					onDoubleClick={() => onResize(defaultWidth)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							event.preventDefault();
							onResize(width + 24);
						}
						if (event.key === "ArrowRight") {
							event.preventDefault();
							onResize(width - 24);
						}
						if (event.key === "Home") {
							event.preventDefault();
							onResize(defaultWidth);
						}
					}}
					onPointerDown={(event) => {
						event.preventDefault();
						dragStart.current = { x: event.clientX, width };
						document.body.classList.add("drawer-resizing");
						const target = event.currentTarget;
						target.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (!dragStart.current) return;
						const delta = dragStart.current.x - event.clientX;
						onResize(dragStart.current.width + delta);
					}}
					onPointerUp={(event) => {
						dragStart.current = null;
						document.body.classList.remove("drawer-resizing");
						if (event.currentTarget.hasPointerCapture(event.pointerId)) {
							event.currentTarget.releasePointerCapture(event.pointerId);
						}
					}}
					onPointerCancel={(event) => {
						dragStart.current = null;
						document.body.classList.remove("drawer-resizing");
						if (event.currentTarget.hasPointerCapture(event.pointerId)) {
							event.currentTarget.releasePointerCapture(event.pointerId);
						}
					}}
				/>
			)}
			<header className="drawer-header">
				<div className="drawer-title">
					{mode === "wiki" ? wiki.path : activeArtifact?.metadata.title ?? "产物"}
				</div>
				<div className="flex items-center gap-1">
					{activeArtifact && (
						<button
							type="button"
							className="icon-btn"
							aria-label="下载"
							onClick={() => {
								const link = document.createElement("a");
								link.href = getArtifactFileUrl(activeArtifact.id, activeArtifact.primaryFile);
								link.download = activeArtifact.primaryFile;
								link.click();
							}}
						>
							<Download className="size-4" />
						</button>
					)}
					<button type="button" className="icon-btn" onClick={onToggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏"}>
						{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
					</button>
					<button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
						<X className="size-4" />
					</button>
				</div>
			</header>
			{mode === "artifacts" && (
				<div className="drawer-tabs">
					{artifacts.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => onSelectArtifact(item.id)}
							className={cn("drawer-tab", item.id === activeArtifactId && "drawer-tab-active")}
						>
							{KIND_ICON[item.kind]} {item.metadata.title.slice(0, 12)}
						</button>
					))}
				</div>
			)}
			<div className="drawer-content">
				{mode === "wiki" && (
					<>
						{wiki.loading && <div className="text-muted-foreground">加载中...</div>}
						{wiki.error && <div className="whitespace-pre-wrap text-destructive">{wiki.error}</div>}
						{!wiki.loading && !wiki.error && <MarkdownView content={wiki.content} />}
					</>
				)}
				{mode === "artifacts" && (
					activeArtifact ? (
						<ArtifactView manifest={activeArtifact} />
					) : (
						<div className="drawer-empty">
							<FileText className="size-9 opacity-30" />
							<span>当前对话还没有产物</span>
						</div>
					)
				)}
			</div>
		</aside>
	);
}
