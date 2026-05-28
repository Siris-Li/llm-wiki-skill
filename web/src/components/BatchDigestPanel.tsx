import { CheckCircle2, Circle, ExternalLink, Loader2, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BatchDigestEvent } from "@/lib/api";

export interface BatchDigestJob {
	id: string;
	kbPath: string;
	status: "running" | "done" | "error";
	total: number;
	completed: number;
	failed: number;
	current?: string;
	outputDir?: string;
	error?: string;
	files: BatchDigestFileState[];
	events: BatchDigestEvent[];
}

export interface BatchDigestFileState {
	index: number;
	filePath: string;
	status: "queued" | "running" | "done" | "error";
	chars?: number;
	outputPath?: string;
	error?: string;
}

interface Props {
	job: BatchDigestJob | null;
	onClose: () => void;
	onOpenOutput: (outputPath: string) => void;
}

export function BatchDigestPanel({ job, onClose, onOpenOutput }: Props) {
	if (!job) return null;
	const percent = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
	return (
		<div className="fixed bottom-4 right-4 z-40 w-[28rem] max-w-[calc(100vw-2rem)] rounded-md border border-input bg-background p-3 shadow-lg">
			<div className="mb-2 flex items-start justify-between gap-3">
				<div>
					<div className="text-sm font-medium">批量消化</div>
					<div className="text-xs text-muted-foreground">
						{job.completed} 完成 / {job.failed} 失败 / {job.total} 总数
					</div>
				</div>
				<Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
					<X className="size-4" />
				</Button>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-muted">
				<div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
			</div>
			{job.current && (
				<div className="mt-2 truncate text-xs text-muted-foreground">{job.current}</div>
			)}
			<div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
				{job.files.map((file) => (
					<div
						key={`${file.index}:${file.filePath}`}
						className="grid grid-cols-[18px_1fr_auto] items-center gap-2 rounded-md border border-input bg-muted/40 px-2 py-1.5 text-xs"
					>
						<FileStatusIcon status={file.status} />
						<div className="min-w-0">
							<div className="truncate text-foreground">{shortName(file.filePath)}</div>
							<div className="truncate text-muted-foreground">
								{file.status === "running"
									? `生成中${file.chars ? `，约 ${file.chars} 字` : ""}`
									: file.status === "done"
										? `已完成${file.chars ? `，约 ${file.chars} 字` : ""}`
										: file.status === "error"
											? file.error
											: "排队中"}
							</div>
						</div>
						{file.outputPath ? (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => onOpenOutput(file.outputPath as string)}
								aria-label="打开结果"
							>
								<ExternalLink className="size-3.5" />
							</Button>
						) : (
							<span className="size-8" />
						)}
					</div>
				))}
			</div>
			{job.status === "done" && (
				<div className="mt-2 text-xs text-emerald-400">已完成：{job.outputDir}</div>
			)}
			{job.status === "error" && (
				<div className="mt-2 text-xs text-destructive">{job.error}</div>
			)}
		</div>
	);
}

function FileStatusIcon({ status }: { status: BatchDigestFileState["status"] }) {
	if (status === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
	if (status === "done") return <CheckCircle2 className="size-4 text-emerald-400" />;
	if (status === "error") return <XCircle className="size-4 text-destructive" />;
	return <Circle className="size-4 text-muted-foreground" />;
}

function shortName(filePath: string): string {
	return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}
