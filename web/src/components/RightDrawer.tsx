import { useEffect } from "react";

import { Download, Maximize2, Minimize2, X } from "lucide-react";

import { ArtifactView } from "@/components/ArtifactView";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/MarkdownView";
import { getArtifactFileUrl, type ArtifactManifest } from "@/lib/api";

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
	onSelectArtifact: (id: string) => void;
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
	onSelectArtifact,
	onToggleFullscreen,
	onClose,
}: Props) {
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
	const widthClass = fullscreen ? "w-screen max-w-none" : "w-[400px] max-w-[85vw]";
	return (
		<aside className={`fixed right-0 top-0 z-30 flex h-full ${widthClass} flex-col border-l border-input bg-background shadow-xl`}>
			<header className="flex items-center justify-between gap-3 border-b border-input px-4 py-3">
				<div className="min-w-0 truncate font-mono text-xs">
					{mode === "wiki" ? wiki.path : activeArtifact?.metadata.title ?? "产物"}
				</div>
				<div className="flex items-center gap-1">
					{activeArtifact && (
						<Button
							variant="ghost"
							size="icon"
							aria-label="下载"
							onClick={() => {
								const link = document.createElement("a");
								link.href = getArtifactFileUrl(activeArtifact.id, activeArtifact.primaryFile);
								link.download = activeArtifact.primaryFile;
								link.click();
							}}
						>
							<Download className="size-4" />
						</Button>
					)}
					<Button variant="ghost" size="icon" onClick={onToggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏"}>
						{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
					</Button>
					<Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
						<X className="size-4" />
					</Button>
				</div>
			</header>
			{mode === "artifacts" && (
				<div className="flex gap-1 overflow-x-auto border-b border-input px-3 py-2">
					{artifacts.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => onSelectArtifact(item.id)}
							className={`shrink-0 rounded-md px-2 py-1 text-xs ${
								item.id === activeArtifactId
									? "bg-primary text-primary-foreground"
									: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							}`}
						>
							{KIND_ICON[item.kind]} {item.metadata.title.slice(0, 12)}
						</button>
					))}
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
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
						<div className="text-muted-foreground">当前对话还没有产物</div>
					)
				)}
			</div>
		</aside>
	);
}
