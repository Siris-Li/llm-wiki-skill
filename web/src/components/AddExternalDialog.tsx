import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	initExistingKnowledgeBase,
	inspectKnowledgeBasePath,
	type InspectPathResult,
} from "@/lib/api";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (path: string) => Promise<void>;
	onStartBatchDigest?: (input: {
		kbPath: string;
		filePaths: string[];
		sourceRoot?: string;
		concurrency: 1 | 3 | 5;
	}) => void;
}

/**
 * 登记外部知识库的对话框。
 * 用户粘绝对路径，后端验证（存在 + 是目录 + 含 .wiki-schema.md）。
 */
export function AddExternalDialog({ open, onOpenChange, onSubmit, onStartBatchDigest }: Props) {
	const [path, setPath] = useState("");
	const [purpose, setPurpose] = useState("");
	const [digestAfterInit, setDigestAfterInit] = useState(true);
	const [concurrency, setConcurrency] = useState<1 | 3 | 5>(3);
	const [inspect, setInspect] = useState<InspectPathResult | null>(null);
	const [inspecting, setInspecting] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [conflicts, setConflicts] = useState<string[]>([]);
	const [dragHint, setDragHint] = useState<string | null>(null);

	const reset = () => {
		setPath("");
		setPurpose("");
		setDigestAfterInit(true);
		setConcurrency(3);
		setInspect(null);
		setError(null);
		setConflicts([]);
		setDragHint(null);
		setSubmitting(false);
	};

	useEffect(() => {
		if (!open || !path.trim()) {
			setInspect(null);
			setInspecting(false);
			return;
		}
		let cancelled = false;
		setInspecting(true);
		setError(null);
		const timer = window.setTimeout(() => {
			inspectKnowledgeBasePath(path)
				.then((result) => {
					if (!cancelled) setInspect(result);
				})
				.catch((err) => {
					if (!cancelled) {
						setInspect(null);
						setError(err instanceof Error ? err.message : String(err));
					}
				})
				.finally(() => {
					if (!cancelled) setInspecting(false);
				});
		}, 300);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [open, path]);

	const handleSubmit = async (overwrite = false) => {
		const trimmed = path.trim();
		if (!trimmed) {
			setError("路径不能为空");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			if (inspect?.exists && inspect.isDirectory && !inspect.hasWikiSchema) {
				if (!purpose.trim()) {
					setError("请先填写研究方向");
					setSubmitting(false);
					return;
				}
				const result = await initExistingKnowledgeBase(trimmed, purpose, overwrite);
				await onSubmit(result.info.path);
				if (
					digestAfterInit &&
					inspect.ingestibleFiles?.paths.length &&
					onStartBatchDigest
				) {
					onStartBatchDigest({
						kbPath: result.info.path,
						filePaths: inspect.ingestibleFiles.paths,
						sourceRoot: inspect.resolvedPath ?? result.info.path,
						concurrency,
					});
				}
			} else {
				await onSubmit(trimmed);
			}
			reset();
			onOpenChange(false);
		} catch (err) {
			const maybeConflicts = (err as Error & { conflicts?: string[] }).conflicts ?? [];
			setConflicts(maybeConflicts);
			setError(err instanceof Error ? err.message : String(err));
			setSubmitting(false);
		}
	};

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) reset();
		onOpenChange(newOpen);
	};

	const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		const types = Array.from(event.dataTransfer.types);
		console.info("[llm-wiki-agent] dropped external path", {
			types,
			uriList: event.dataTransfer.getData("text/uri-list"),
			text: event.dataTransfer.getData("text/plain"),
			files: event.dataTransfer.files.length,
		});
		const parsed = parseDroppedPath(event.dataTransfer);
		if (parsed) {
			setPath(parsed);
			setDragHint(null);
		} else {
			setDragHint("这次拖拽没有暴露真实路径，请直接粘贴路径");
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>添加现有知识库</DialogTitle>
					<DialogDescription>
						输入一个绝对路径，目录里需要含有 <code>.wiki-schema.md</code>（由 llm-wiki-skill 初始化产生）。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 py-2">
					<div
						onDragOver={(event) => event.preventDefault()}
						onDrop={handleDrop}
						className="rounded-md border border-dashed border-input bg-muted/40 px-3 py-5 text-center text-xs text-muted-foreground"
					>
						把文件夹拖到这里，或在下面粘贴路径
					</div>
					<Input
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="/Users/yourname/Documents/我的知识库"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !submitting) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						autoFocus
					/>
					{dragHint && <div className="text-xs text-muted-foreground">{dragHint}</div>}
					{inspecting && <div className="text-xs text-muted-foreground">检查中…</div>}
					{inspect && (
						<div className="rounded-md border border-input bg-muted px-2 py-1.5 text-xs text-muted-foreground">
							{!inspect.exists
								? "路径不存在"
								: !inspect.isDirectory
									? "这不是目录"
									: inspect.hasWikiSchema
										? "这是可添加的知识库"
										: `不是知识库，可初始化；发现 ${inspect.ingestibleFiles?.count ?? 0} 个可消化文件`}
							{inspect.ingestibleFiles?.samples.length ? (
								<div className="mt-1 truncate opacity-70">
									{inspect.ingestibleFiles.samples.join(" / ")}
								</div>
							) : null}
						</div>
					)}
					{inspect?.exists && inspect.isDirectory && !inspect.hasWikiSchema && (
						<div className="space-y-2 rounded-md border border-input p-2">
							<Input
								value={purpose}
								onChange={(e) => setPurpose(e.target.value)}
								placeholder="这个知识库研究什么？"
							/>
							<label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
								<span>初始化后立即批量消化</span>
								<input
									type="checkbox"
									checked={digestAfterInit}
									onChange={(e) => setDigestAfterInit(e.target.checked)}
									className="size-4 accent-primary"
								/>
							</label>
							{digestAfterInit && (
								<select
									value={concurrency}
									onChange={(e) => setConcurrency(Number(e.target.value) as 1 | 3 | 5)}
									className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
								>
									<option value={1}>并发 1</option>
									<option value={3}>并发 3</option>
									<option value={5}>并发 5</option>
								</select>
							)}
						</div>
					)}
					{conflicts.length > 0 && (
						<div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-300">
							<div>这些文件会先备份再覆盖：</div>
							<div className="mt-1 break-all">{conflicts.join(", ")}</div>
						</div>
					)}
					{error && (
						<div className="rounded-md border border-destructive bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
							{error}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
						取消
					</Button>
					{conflicts.length > 0 ? (
						<Button onClick={() => handleSubmit(true)} disabled={submitting}>
							{submitting ? "处理中…" : "备份并继续"}
						</Button>
					) : (
						<Button onClick={() => handleSubmit(false)} disabled={submitting}>
							{submitting
								? "处理中…"
								: inspect?.exists && inspect.isDirectory && !inspect.hasWikiSchema
									? "初始化并添加"
									: "添加"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function parseDroppedPath(dataTransfer: DataTransfer): string | null {
	for (const type of ["text/uri-list", "text/plain"]) {
		const raw = dataTransfer.getData(type).trim();
		if (!raw) continue;
		const first = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line && !line.startsWith("#"));
		if (!first) continue;
		if (first.startsWith("file://")) return decodeURIComponent(new URL(first).pathname);
		if (first.startsWith("/") || first.startsWith("~/")) return first;
	}
	return null;
}
